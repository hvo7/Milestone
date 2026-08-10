/**
 * Notion sync — three relational databases:
 *   1. Questlines  (icon, title, direction/description, status, progress, streak)
 *   2. Quests      (title, due, progress, ← Questline relation, recurring, status, streak)
 *   3. Tasks       (title, daily/weekly, done, streak)
 *
 * Quests.Questline is a single-property relation pointing to Questlines,
 * so Notion shows the link automatically in both tables.
 *
 * Runs in the Electron main process — uses native fetch (Node 22 / Electron 36).
 */

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VER = '2022-06-28';

// ── Persistence ───────────────────────────────────────────────────────────────

const configFile = () => path.join(app.getPath('userData'), 'notion-config.json');
const idMapFile  = () => path.join(app.getPath('userData'), 'notion-id-map.json');

/**
 * The API key is a live credential with write access to the user's Notion
 * workspace, and it used to sit in plain text in a JSON file next to the
 * profile — readable by anything running as this user, and easy to sweep up in
 * a backup or a synced folder.
 *
 * `safeStorage` wraps the OS keystore (DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux), so the ciphertext is bound to this user account on this
 * machine. Where the OS can't provide that, encryption is unavailable and the
 * key is stored as before rather than refusing to work — the file records which
 * of the two it is, so reads never have to guess.
 */
const canEncrypt = () => {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
};

function loadConfig() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return null; }
  if (!raw) return null;

  if (raw.apiKeyEncrypted) {
    try {
      return { ...raw, apiKey: safeStorage.decryptString(Buffer.from(raw.apiKeyEncrypted, 'base64')), apiKeyEncrypted: undefined };
    } catch {
      // A profile copied to another machine or account can't be decrypted here.
      // Losing the key means re-entering it, which is recoverable; pretending the
      // config is fine and sending an empty Authorization header is not.
      return { ...raw, apiKey: '', apiKeyEncrypted: undefined };
    }
  }
  // Plaintext from an older build. Upgrade it in place rather than waiting for
  // the user to happen to re-save — the whole point is that it stops being
  // readable on disk, and "next time you edit settings" may be never.
  if (raw.apiKey && canEncrypt()) {
    try { saveConfig(raw); } catch { /* keep going; the key still works in memory */ }
  }
  return raw;
}

function saveConfig(c) {
  const out = { ...c };
  if (out.apiKey && canEncrypt()) {
    out.apiKeyEncrypted = safeStorage.encryptString(out.apiKey).toString('base64');
    delete out.apiKey;
  }
  fs.writeFileSync(configFile(), JSON.stringify(out, null, 2), 'utf8');
}

function loadIdMap() {
  try { return JSON.parse(fs.readFileSync(idMapFile(), 'utf8')); }
  catch { return { questlinesDbId: null, questsDbId: null, routinesDbId: null, questlines: {}, quests: {}, routines: {} }; }
}
function saveIdMap(m) { fs.writeFileSync(idMapFile(), JSON.stringify(m, null, 2), 'utf8'); }

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function notion(method, endpoint, apiKey, body) {
  const res = await fetch(`${NOTION_API}${endpoint}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Notion ${res.status}`);
  return data;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const cap  = s  => s ? s[0].toUpperCase() + s.slice(1) : '';

// Strip leading Roman-numeral prefix added by the app (e.g. "III — Learn Korean" → "Learn Korean")
const stripRoman = title => title.replace(/^[IVXLCDM]+\s*[—–-]+\s*/u, '').trim();

// ── Database schemas ──────────────────────────────────────────────────────────

async function createQuestlinesDB(parentPageId, apiKey) {
  return notion('POST', '/databases', apiKey, {
    parent: { type: 'page_id', page_id: parentPageId },
    icon:  { type: 'emoji', emoji: '🗺️' },
    title: [{ type: 'text', text: { content: 'Questlines' } }],
    properties: {
      'Name':        { title: {} },
      'Direction':   { rich_text: {} },
      'Status':      { select: { options: [
        { name: 'Active',      color: 'blue'   },
        { name: 'In Progress', color: 'yellow' },
        { name: 'Complete',    color: 'green'  },
      ]}},
      'Progress':    { rich_text: {} },
      'Streak':      { number: { format: 'number' } },
      'Last Synced': { date: {} },
    },
  });
}

async function createQuestsDB(parentPageId, questlinesDbId, apiKey) {
  return notion('POST', '/databases', apiKey, {
    parent: { type: 'page_id', page_id: parentPageId },
    icon:  { type: 'emoji', emoji: '⚔️' },
    title: [{ type: 'text', text: { content: 'Quests' } }],
    properties: {
      'Name':        { title: {} },
      'Questline':   { type: 'relation', relation: { database_id: questlinesDbId, type: 'single_property', single_property: {} } },
      'Due':         { date: {} },
      'Progress':    { rich_text: {} },
      'Status':      { select: { options: [
        { name: 'Not Started', color: 'gray'   },
        { name: 'In Progress', color: 'yellow' },
        { name: 'Complete',    color: 'green'  },
      ]}},
      'Recurring':   { select: { options: [
        { name: 'Once',    color: 'default' },
        { name: 'Daily',   color: 'yellow'  },
        { name: 'Weekly',  color: 'blue'    },
        { name: 'Monthly', color: 'green'   },
      ]}},
      'Streak':      { number: { format: 'number' } },
      'Last Synced': { date: {} },
    },
  });
}

async function createRoutinesDB(parentPageId, apiKey) {
  return notion('POST', '/databases', apiKey, {
    parent: { type: 'page_id', page_id: parentPageId },
    icon:  { type: 'emoji', emoji: '✅' },
    title: [{ type: 'text', text: { content: 'Tasks' } }],
    properties: {
      'Name':        { title: {} },
      'Type':        { select: { options: [
        { name: 'Daily',  color: 'yellow' },
        { name: 'Weekly', color: 'blue'   },
      ]}},
      'Done':        { checkbox: {} },
      'Streak':      { number: { format: 'number' } },
      'Last Synced': { date: {} },
    },
  });
}

// ── Block helpers ─────────────────────────────────────────────────────────────

const para  = (text, ann = {}) => ({ type: 'paragraph',  paragraph:  { rich_text: [{ type: 'text', text: { content: text }, annotations: ann }] } });
const todo  = (text, checked)  => ({ type: 'to_do',      to_do:      { rich_text: [{ type: 'text', text: { content: text } }], checked } });
const divider = ()             => ({ type: 'divider',    divider: {} });

function questActionBlocks(quest) {
  const blocks = [];
  if (quest.description) blocks.push(para(quest.description, { italic: true, color: 'gray' }));

  const actions = quest.actions.filter(a => !a.hidden);
  if (actions.length) {
    actions.forEach(a => {
      const label = a.recurring ? `${a.title}  (${a.recurring})` : a.title;
      blocks.push(todo(label, a.completed));
    });
  } else {
    blocks.push(para('No deeds recorded yet.', { italic: true, color: 'gray' }));
  }
  return blocks;
}

// ── Page content management ───────────────────────────────────────────────────

async function clearPage(pageId, apiKey) {
  let cursor;
  const ids = [];
  do {
    const qs = cursor ? `?start_cursor=${cursor}` : '';
    const data = await notion('GET', `/blocks/${pageId}/children${qs}`, apiKey);
    ids.push(...data.results.map(b => b.id));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  for (const id of ids) { await notion('DELETE', `/blocks/${id}`, apiKey); await wait(340); }
}

async function appendBlocks(pageId, blocks, apiKey) {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion('PATCH', `/blocks/${pageId}/children`, apiKey, { children: blocks.slice(i, i + 100) });
    if (i + 100 < blocks.length) await wait(340);
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────

function qlStatus(ql) {
  const vis = ql.quests.filter(q => !q.hidden);
  if (!vis.length) return 'Active';
  const done = vis.filter(q => { const a = q.actions.filter(x => !x.hidden); return a.length > 0 && a.every(x => x.completed); }).length;
  if (done === vis.length) return 'Complete';
  if (done > 0) return 'In Progress';
  return 'Active';
}

function questStatus(quest) {
  const vis = quest.actions.filter(a => !a.hidden);
  if (!vis.length) return 'Not Started';
  if (vis.every(a => a.completed)) return 'Complete';
  if (vis.some(a => a.completed)) return 'In Progress';
  return 'Not Started';
}

// ── Public API ────────────────────────────────────────────────────────────────

async function testConnection(apiKey) {
  try {
    const me = await notion('GET', '/users/me', apiKey);
    return { ok: true, name: me.name || me.bot?.owner?.user?.name || 'Integration' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function syncToNotion(questlines, routines, config) {
  const { apiKey, parentPageId } = config;
  const log = [];
  let idMap = loadIdMap();
  const now = new Date().toISOString();

  // ── 0. Migrate from old single-database format ────────────────────────────
  if (idMap.databaseId && !idMap.questlinesDbId) {
    log.push('Migrating from old sync format — new databases will be created.');
    idMap = { questlinesDbId: null, questsDbId: null, routinesDbId: null, questlines: {}, quests: {}, routines: {} };
    saveIdMap(idMap);
  }

  // ── 1. Create databases if they don't exist ────────────────────────────────
  if (!idMap.questlinesDbId) {
    log.push('Creating Questlines database...');
    const db = await createQuestlinesDB(parentPageId, apiKey);
    idMap.questlinesDbId = db.id;
    saveIdMap(idMap);
    await wait(500);
  }

  if (!idMap.questsDbId) {
    log.push('Creating Quests database...');
    const db = await createQuestsDB(parentPageId, idMap.questlinesDbId, apiKey);
    idMap.questsDbId = db.id;
    saveIdMap(idMap);
    await wait(500);
  }

  if (!idMap.routinesDbId) {
    log.push('Creating Tasks database...');
    const db = await createRoutinesDB(parentPageId, apiKey);
    idMap.routinesDbId = db.id;
    saveIdMap(idMap);
    await wait(500);
  } else {
    // Rename legacy "Routines" database to "Tasks" if it still has the old title
    try {
      await notion('PATCH', `/databases/${idMap.routinesDbId}`, apiKey, {
        title: [{ type: 'text', text: { content: 'Tasks' } }],
        icon: { type: 'emoji', emoji: '✅' },
      });
    } catch {}
  }

  // ── 2. Sync questlines ────────────────────────────────────────────────────
  log.push('Syncing questlines...');
  const activeQlIds = new Set(questlines.filter(ql => !ql.hidden).map(ql => ql.id));

  for (const ql of questlines.filter(ql => !ql.hidden)) {
    const vis  = ql.quests.filter(q => !q.hidden);
    const done = vis.filter(q => { const a = q.actions.filter(x => !x.hidden); return a.length > 0 && a.every(x => x.completed); }).length;

    const props = {
      'Name':        { title: [{ text: { content: `${ql.icon}  ${ql.title}` } }] },
      'Direction':   { rich_text: [{ text: { content: ql.description || '' } }] },
      'Status':      { select: { name: qlStatus(ql) } },
      'Progress':    { rich_text: [{ text: { content: `${done} / ${vis.length} quests` } }] },
      'Streak':      { number: ql.streak ?? 0 },
      'Last Synced': { date: { start: now } },
    };

    const existing = idMap.questlines?.[ql.id];
    if (existing) {
      try {
        await notion('PATCH', `/pages/${existing}`, apiKey, { properties: props, archived: false });
        log.push(`  Updated questline: ${ql.title}`);
      } catch {
        const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.questlinesDbId }, properties: props });
        idMap.questlines[ql.id] = page.id;
        saveIdMap(idMap);
        log.push(`  Recreated questline: ${ql.title}`);
      }
    } else {
      const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.questlinesDbId }, properties: props });
      if (!idMap.questlines) idMap.questlines = {};
      idMap.questlines[ql.id] = page.id;
      saveIdMap(idMap);
      log.push(`  Created questline: ${ql.title}`);
    }
    await wait(350);
  }

  // Archive removed questlines
  for (const [qlId, pageId] of Object.entries(idMap.questlines || {})) {
    if (!activeQlIds.has(qlId)) {
      try { await notion('PATCH', `/pages/${pageId}`, apiKey, { archived: true }); } catch {}
      delete idMap.questlines[qlId];
      saveIdMap(idMap);
      await wait(340);
    }
  }

  // ── 3. Sync quests ────────────────────────────────────────────────────────
  log.push('Syncing quests...');
  const activeQIds = new Set(
    questlines.filter(ql => !ql.hidden).flatMap(ql => ql.quests.filter(q => !q.hidden).map(q => q.id))
  );

  for (const ql of questlines.filter(ql => !ql.hidden)) {
    const qlPageId = idMap.questlines?.[ql.id];
    if (!qlPageId) continue;

    for (const quest of ql.quests.filter(q => !q.hidden)) {
      const acts  = quest.actions.filter(a => !a.hidden);
      const done  = acts.filter(a => a.completed).length;
      const total = acts.length;

      const props = {
        'Name':        { title: [{ text: { content: stripRoman(quest.title) } }] },
        'Questline':   { relation: [{ id: qlPageId }] },
        'Due':         quest.dueDate ? { date: { start: quest.dueDate } } : { date: null },
        'Progress':    { rich_text: [{ text: { content: `${done} / ${total} actions` } }] },
        'Status':      { select: { name: questStatus(quest) } },
        'Recurring':   { select: { name: quest.recurring ? cap(quest.recurring) : 'Once' } },
        'Streak':      { number: quest.streak ?? 0 },
        'Last Synced': { date: { start: now } },
      };

      const blocks  = questActionBlocks(quest);
      const existing = idMap.quests?.[quest.id];

      if (existing) {
        try {
          await notion('PATCH', `/pages/${existing}`, apiKey, { properties: props, archived: false });
          await clearPage(existing, apiKey);
          await appendBlocks(existing, blocks, apiKey);
        } catch {
          const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.questsDbId }, properties: props, children: blocks });
          idMap.quests[quest.id] = page.id;
          saveIdMap(idMap);
        }
      } else {
        const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.questsDbId }, properties: props, children: blocks });
        if (!idMap.quests) idMap.quests = {};
        idMap.quests[quest.id] = page.id;
        saveIdMap(idMap);
      }
      await wait(350);
    }
  }

  // Archive removed quests
  for (const [qId, pageId] of Object.entries(idMap.quests || {})) {
    if (!activeQIds.has(qId)) {
      try { await notion('PATCH', `/pages/${pageId}`, apiKey, { archived: true }); } catch {}
      delete idMap.quests[qId];
      saveIdMap(idMap);
      await wait(340);
    }
  }

  // ── 4. Sync routines ──────────────────────────────────────────────────────
  const visRoutines = routines.filter(r => !r.hidden);
  if (visRoutines.length) {
    log.push('Syncing tasks...');
    const activeRIds = new Set(visRoutines.map(r => r.id));

    for (const r of visRoutines) {
      const props = {
        'Name':        { title: [{ text: { content: r.title } }] },
        'Type':        { select: { name: cap(r.recurring) } },
        'Done':        { checkbox: r.completed },
        'Streak':      { number: r.streak ?? 0 },
        'Last Synced': { date: { start: now } },
      };

      const existing = idMap.routines?.[r.id];
      if (existing) {
        try { await notion('PATCH', `/pages/${existing}`, apiKey, { properties: props, archived: false }); }
        catch {
          const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.routinesDbId }, properties: props });
          idMap.routines[r.id] = page.id;
          saveIdMap(idMap);
        }
      } else {
        const page = await notion('POST', '/pages', apiKey, { parent: { database_id: idMap.routinesDbId }, properties: props });
        if (!idMap.routines) idMap.routines = {};
        idMap.routines[r.id] = page.id;
        saveIdMap(idMap);
      }
      await wait(340);
    }

    // Archive removed routines
    for (const [rId, pageId] of Object.entries(idMap.routines || {})) {
      if (!activeRIds.has(rId)) {
        try { await notion('PATCH', `/pages/${pageId}`, apiKey, { archived: true }); } catch {}
        delete idMap.routines[rId];
        saveIdMap(idMap);
        await wait(340);
      }
    }
  }

  log.push('Sync complete!');
  return { ok: true, log };
}

// ── Pull from Notion ──────────────────────────────────────────────────────────
// Reads back only the two cheap, non-destructive properties:
//   • Tasks  → Done checkbox   → updates routine.completed
//   • Quests → Status select   → if Complete/Not Started, marks all actions done/undone
//   "In Progress" quests are intentionally left untouched.

async function pullFromNotion(config) {
  const { apiKey } = config;
  const log = [];
  const idMap = loadIdMap();

  if (!idMap.questsDbId && !idMap.routinesDbId) {
    return { ok: false, error: 'No sync data found — run a Push sync first so Milestone knows which Notion pages to read.' };
  }

  const taskUpdates  = []; // [{ id: routineId, completed: bool }]
  const questUpdates = []; // [{ questId, complete: bool }]

  // ── Tasks (done checkbox) ────────────────────────────────────────────────
  const routineEntries = Object.entries(idMap.routines || {});
  if (routineEntries.length) {
    log.push(`Reading ${routineEntries.length} tasks from Notion…`);
    for (const [routineId, pageId] of routineEntries) {
      try {
        const page = await notion('GET', `/pages/${pageId}`, apiKey);
        const done = page.properties?.Done?.checkbox ?? false;
        taskUpdates.push({ id: routineId, completed: done });
      } catch {}
      await wait(340);
    }
    log.push(`  ${taskUpdates.length} task statuses read.`);
  }

  // ── Quest status ──────────────────────────────────────────────────────────
  const questEntries = Object.entries(idMap.quests || {});
  if (questEntries.length) {
    log.push(`Reading ${questEntries.length} quest statuses from Notion…`);
    let changed = 0;
    for (const [questId, pageId] of questEntries) {
      try {
        const page = await notion('GET', `/pages/${pageId}`, apiKey);
        const status = page.properties?.Status?.select?.name ?? null;
        if (status === 'Complete') {
          questUpdates.push({ questId, complete: true });
          changed++;
        } else if (status === 'Not Started') {
          questUpdates.push({ questId, complete: false });
          changed++;
        }
        // "In Progress" → leave app state alone
      } catch {}
      await wait(340);
    }
    log.push(`  ${changed} quest statuses updated.`);
  }

  log.push('Pull complete!');
  return { ok: true, log, taskUpdates, questUpdates };
}

module.exports = { loadConfig, saveConfig, testConnection, syncToNotion, pullFromNotion };
