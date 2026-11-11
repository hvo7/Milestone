import { DurableObject } from 'cloudflare:workers';

// One private household relay. All routes use the same persistent object.
// It coordinates snapshots; reconciliation remains in Milestone's client.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DEVICES = 16;
const MAX_BACKUPS = 20;
const CHUNK_CHARS = 100_000;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Milestone-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};
const json = (body, status = 200) => Response.json(body, { status, headers: cors });

async function authorized(request, env) {
  if (typeof env.MILESTONE_TOKEN !== 'string' || env.MILESTONE_TOKEN.length < 32) return false;
  const token = request.headers.get('X-Milestone-Token') || new URL(request.url).searchParams.get('t') || '';
  if (!token || token.length > 512) return false;
  const encode = value => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([token, env.MILESTONE_TOKEN].map(value => crypto.subtle.digest('SHA-256', encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readJSON(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new Error('Payload exceeds 8 MB.');
  if (!request.body) throw new Error('Missing JSON body.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Payload exceeds 8 MB.'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

function validDocument(doc) {
  const clock = value => value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([id, count]) => ID.test(id) && Number.isSafeInteger(count) && count >= 0);
  if (!doc || doc._milestoneSync !== 1 || typeof doc.deviceId !== 'string' || !ID.test(doc.deviceId) || typeof doc.deviceName !== 'string'
    || !Number.isFinite(Date.parse(doc.updatedAt)) || !clock(doc.clock) || !doc.stores || typeof doc.stores !== 'object' || Array.isArray(doc.stores)) return false;
  return ['quest', 'vynues', 'ui'].every(slot => {
    if (doc.slotClocks?.[slot] && !clock(doc.slotClocks[slot])) return false;
    if (doc.stores[slot] === undefined) return true;
    try {
      const parsed = JSON.parse(doc.stores[slot]);
      return typeof doc.stores[slot] === 'string' && parsed?.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state);
    } catch { return false; }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (!env.ASSETS) return json({ ok: false, error: 'App assets are not installed.' }, 404);
      const response = await env.ASSETS.fetch(request);
      const safe = new Response(response.body, response);
      safe.headers.set('Referrer-Policy', 'no-referrer');
      if (!url.pathname.startsWith('/assets/')) safe.headers.set('Cache-Control', 'no-cache');
      return safe;
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, app: 'milestone', relay: true, push: 'websocket', protocol: 1,
        configured: typeof env.MILESTONE_TOKEN === 'string' && env.MILESTONE_TOKEN.length >= 32 });
    }
    if (!await authorized(request, env)) return json({ ok: false, error: 'Wrong or missing pairing key.' }, 401);
    try {
      return await env.RELAY.get(env.RELAY.idFromName('private-relay-v1')).fetch(request);
    } catch {
      // Never put snapshots, keys, request URLs, or database errors into logs/responses.
      return json({ ok: false, error: 'Sync storage unavailable. Changes remain on your device; retry later.' }, 503);
    }
  },
};

export class MilestoneRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, saved INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (id TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (id, part))');
  }

  read(id) {
    const rows = this.sql.exec('SELECT value FROM chunks WHERE id = ? ORDER BY part', id).toArray();
    return rows.length ? JSON.parse(rows.map(row => row.value).join('')) : null;
  }

  save(id, kind, value) {
    const text = JSON.stringify(value);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT OR REPLACE INTO objects (id, kind, saved) VALUES (?, ?, ?)', id, kind, Date.now());
      this.sql.exec('DELETE FROM chunks WHERE id = ?', id);
      for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
        this.sql.exec('INSERT INTO chunks (id, part, value) VALUES (?, ?, ?)', id, offset / CHUNK_CHARS, text.slice(offset, offset + CHUNK_CHARS));
      }
      // Bounded recovery storage, documented in the setup guide. Device data is never pruned.
      const old = this.sql.exec("SELECT id FROM objects WHERE kind = 'backup' ORDER BY saved DESC, id DESC LIMIT -1 OFFSET ?", MAX_BACKUPS).toArray();
      for (const row of old) {
        this.sql.exec('DELETE FROM chunks WHERE id = ?', row.id);
        this.sql.exec('DELETE FROM objects WHERE id = ?', row.id);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get('deviceId') || '';
    if (url.pathname === '/api/events' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!ID.test(deviceId)) return json({ ok: false, error: 'Invalid device id.' }, 400);
      if (this.ctx.getWebSockets().length >= 32) return json({ ok: false, error: 'Too many live connections.' }, 429);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ deviceId });
      pair[1].send(JSON.stringify({ type: 'hello' }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/api/events') return json({ ok: false, error: 'Use WebSocket notifications or polling.' }, 426);
    if (url.pathname === '/api/peers' && request.method === 'GET') {
      const peers = this.sql.exec("SELECT id FROM objects WHERE kind = 'device' AND id != ? ORDER BY id", `device:${deviceId}`)
        .toArray().map(row => this.read(row.id));
      return json({ ok: true, peers });
    }
    if (url.pathname === '/api/backups' && request.method === 'GET') {
      const backups = this.sql.exec("SELECT id, saved FROM objects WHERE kind = 'backup' ORDER BY saved DESC").toArray();
      return json({ ok: true, backups });
    }
    if (url.pathname === '/api/backup' && request.method === 'GET') {
      const backup = this.read(`backup:${url.searchParams.get('name')}`);
      return backup ? json({ ok: true, bundle: backup }) : json({ ok: false, error: 'Backup not found.' }, 404);
    }
    if (request.method !== 'POST' || !['/api/write', '/api/backup'].includes(url.pathname)) return json({ ok: false, error: 'Not found.' }, 404);
    let body;
    try { body = await readJSON(request); }
    catch { return json({ ok: false, error: 'Invalid JSON or payload exceeds 8 MB.' }, 400); }
    if (url.pathname === '/api/backup') {
      if (typeof body?.name !== 'string' || !/^[\w.-]{1,200}$/.test(body.name) || body.bundle?._milestone !== 2) return json({ ok: false, error: 'Invalid backup.' }, 400);
      this.save(`backup:${body.name}`, 'backup', body.bundle);
      return json({ ok: true });
    }
    if (!validDocument(body)) return json({ ok: false, error: 'Invalid sync document.' }, 400);
    const id = `device:${body.deviceId}`;
    const existing = this.read(id);
    if (!existing && this.sql.exec("SELECT count(*) AS total FROM objects WHERE kind = 'device'").one().total >= MAX_DEVICES) {
      return json({ ok: false, error: 'This private relay supports 16 devices.' }, 409);
    }
    // An interrupted older upload must not roll back a device's acknowledged clock.
    if (existing && Object.entries(existing.clock).some(([key, count]) => (body.clock[key] ?? 0) < count)) {
      return json({ ok: false, error: 'This device sent an older snapshot. Reconnect before retrying.' }, 409);
    }
    this.save(id, 'device', body);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.deserializeAttachment()?.deviceId === body.deviceId) continue;
      try { socket.send(JSON.stringify({ type: 'changed', from: body.deviceId })); }
      catch { socket.close(1011, 'Reconnect'); }
    }
    return json({ ok: true, at: new Date().toISOString() });
  }

  webSocketMessage(socket) { socket.close(1008, 'Notifications only; use the HTTP API for writes.'); }
  webSocketClose(socket, code) { socket.close(code, ''); }
  webSocketError(socket) { socket.close(1011, 'Reconnect'); }
}
