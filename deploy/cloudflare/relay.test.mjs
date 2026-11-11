import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const token = 'synthetic-test-key-not-a-real-secret-0123456789';
const scriptPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const doc = (deviceId, count = 1, text = 'Synthetic task') => ({
  _milestoneSync: 1, deviceId, deviceName: deviceId, updatedAt: new Date().toISOString(),
  clock: { [deviceId]: count }, stores: { quest: JSON.stringify({ state: { routines: [], questlines: [], text } }) },
});

test('Cloudflare runtime: authentication, live delivery, persistence, backups and limits', { timeout: 90000 }, async t => {
  const storage = await mkdtemp(path.join(tmpdir(), 'milestone-cloudflare-test-'));
  const options = convertV4MiniflareOptions({ modules: true, scriptPath, compatibilityDate: '2026-10-01',
    bindings: { MILESTONE_TOKEN: token },
    durableObjects: { RELAY: { className: 'MilestoneRelay', useSQLite: true } },
    durableObjectsPersist: storage });
  // The v5 adapter doesn't map the old plugin-specific persistence option.
  options.resourcePersistencePath = storage;
  options.logRequests = false;
  let runtime = new Miniflare(options);
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) { try { socket.close(); } catch { /* already closed */ } }
    await runtime.dispose();
    // This exact directory was minted for this test; it contains no user profile.
    assert.equal(path.dirname(storage), tmpdir());
    assert.ok(path.basename(storage).startsWith('milestone-cloudflare-test-'));
    await rm(storage, { recursive: true, force: true });
  });
  const request = (route, body, key = token) => runtime.dispatchFetch(`https://relay.test/api/${route}`, {
    headers: { 'X-Milestone-Token': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const health = await (await request('health', null, '')).json();
  assert.equal(health.push, 'websocket');
  assert.equal((await request('peers', null, 'wrong')).status, 401);
  assert.equal((await request('write', doc('../escape'))).status, 400);
  assert.equal((await request('write', { ...doc('missing'), deviceId: undefined })).status, 400);
  assert.equal((await request('write', { ...doc('bad'), stores: { quest: '{broken' } })).status, 400);

  const connect = async id => {
    const res = await runtime.dispatchFetch(`https://relay.test/api/events?deviceId=${id}&t=${token}`, { headers: { Upgrade: 'websocket' } });
    assert.equal(res.status, 101);
    const socket = res.webSocket; socket.accept(); sockets.push(socket);
    return socket;
  };
  const changed = socket => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No live notification')), 5000);
    const listen = event => {
      const message = JSON.parse(event.data);
      if (message.type !== 'changed') return;
      clearTimeout(timer); socket.removeEventListener('message', listen); resolve(message);
    };
    socket.addEventListener('message', listen);
  });
  const desktop = await connect('desktop'), phone = await connect('phone');
  const onPhone = changed(phone);
  assert.equal((await request('write', doc('desktop'))).status, 200);
  assert.equal((await onPhone).from, 'desktop');
  const onDesktop = changed(desktop);
  await request('write', doc('phone'));
  assert.equal((await onDesktop).from, 'phone');
  assert.equal((await (await request('peers?deviceId=phone')).json()).peers[0].deviceId, 'desktop');

  // Exceeds SQLite's single-row limit: chunked storage must round-trip intact.
  const large = 'x'.repeat(2_500_000);
  assert.equal((await request('write', doc('desktop', 2, large))).status, 200);
  assert.equal((await request('write', doc('desktop', 1))).status, 409);
  const saved = await (await request('peers?deviceId=phone')).json();
  assert.equal(JSON.parse(saved.peers[0].stores.quest).state.text.length, large.length);
  assert.equal((await request('write', doc('desktop', 3, 'x'.repeat(9 * 1024 * 1024)))).status, 400);

  for (let i = 0; i < 22; i++) await request('backup', { name: `backup-${i}`, bundle: { _milestone: 2, quest: 'synthetic' } });
  const backups = await (await request('backups')).json();
  assert.equal(backups.backups.length, 20);
  const name = backups.backups[0].id.slice('backup:'.length);
  assert.equal((await (await request(`backup?name=${name}`)).json()).bundle._milestone, 2);

  for (const socket of sockets) socket.close();
  await runtime.dispose();
  runtime = new Miniflare(options);
  const recovered = await (await request('peers?deviceId=phone')).json();
  assert.equal(recovered.peers[0].clock.desktop, 2);
  assert.equal(JSON.parse(recovered.peers[0].stores.quest).state.text.length, large.length);
});
