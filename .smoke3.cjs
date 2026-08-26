/**
 * Drives the real built app through everything added in this pass: undo, search,
 * consistency, reminders + tray IPC, the browser-build IndexedDB backups, and a
 * regression pass over the Today refactor.
 *
 * Uses a throwaway userData dir, so the real profile is never touched, and
 * synthetic data throughout — nothing personal goes near a screenshot.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = process.env.SMOKE_REPO;
const OUT = process.env.SMOKE_OUT;

/** The anchor-habit group heading, lifted straight out of src/lib/ui.ts. */
const ANCHOR_LABEL = /ANCHOR_LABEL\s*=\s*'([^']+)'/
  .exec(fs.readFileSync(path.join(REPO, 'src', 'lib', 'ui.ts'), 'utf8'))[1];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-smoke3-'));
app.setPath('userData', profile);
if (process.platform === 'win32') app.setAppUserModelId('Milestone');

// The real main-process modules, so this exercises production code, not stubs.
const backups = require(path.join(REPO, 'electron', 'backups.cjs'));
const cloudSync = require(path.join(REPO, 'electron', 'cloudSync.cjs'));
const tray = require(path.join(REPO, 'electron', 'tray.cjs'));

const trayCalls = [];
const notifyCalls = [];

ipcMain.handle('backup:save', (_e, b) => backups.save(b));
ipcMain.handle('backup:list', () => backups.list());
ipcMain.handle('backup:read', (_e, n) => backups.read(n));
ipcMain.handle('backup:reveal', () => '');
ipcMain.handle('sync:get-config', () => cloudSync.loadConfig());
ipcMain.handle('sync:set-config', (_e, p) => cloudSync.setConfig(p));
ipcMain.handle('sync:read-peers', () => cloudSync.readPeers());
ipcMain.handle('sync:write', (_e, d) => cloudSync.writeDoc(d));
ipcMain.handle('sync:write-backup', (_e, { name, bundle }) => cloudSync.writeBackup(name, bundle));
ipcMain.handle('notion:load-config', () => null);
// Real tray module, with the calls recorded so the renderer contract is checked.
ipcMain.handle('tray:update', (_e, state) => { trayCalls.push(state); return tray.update(state); });
ipcMain.handle('notify', (_e, { title, body }) => { notifyCalls.push({ title, body }); return tray.notify(title, body); });

/**
 * Survive losing the parent.
 *
 * If whatever launched this goes away mid-run — a tool timeout, a closed
 * terminal — the pipe behind stdout breaks and the next console.log throws
 * EPIPE. In a *main process* that surfaces as Electron's "A JavaScript error
 * occurred" dialog on the user's desktop, from a window they never opened,
 * and the orphan sits there until it's killed by hand.
 *
 * So: a dead pipe means the run has no audience left. Stop writing, and go.
 */
let piped = true;
for (const s of [process.stdout, process.stderr]) s.on('error', () => { piped = false; });
const say = line => { if (piped) { try { process.stdout.write(line + '\n'); } catch { piped = false; } } };
const bail = code => { try { app.exit(code); } catch { process.exit(code); } };
process.on('uncaughtException', e => {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) { piped = false; bail(3); return; }
  say('FATAL ' + (e && e.stack ? e.stack : e));
  bail(2);
});
process.on('unhandledRejection', e => { say('FATAL(promise) ' + (e && e.stack ? e.stack : e)); bail(2); });

/** Never outlive the run. A hung driver must not leave an app on the desktop. */
const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS || 15 * 60_000);
setTimeout(() => { say('TIMEOUT  budget exhausted'); bail(4); }, BUDGET_MS).unref?.();

const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 160) : ''}`);
};

/** Synthetic store payload: three questlines, linked routines, nested steps. */
function fixture() {
  const now = new Date().toISOString();
  const mkAction = (id, title) => ({ id, title, completed: false });
  const state = {
    questlines: [
      { id: 'ql-health', title: 'Health & Fitness', description: '', icon: '💪', color: 'emerald', quests: [
        { id: 'q-base', title: 'I — Build a base', description: '', order: 1, actions: [mkAction('a-squat', 'Squats 3x8'), mkAction('a-run', 'Run 5k')] },
        { id: 'q-next', title: 'II — Add volume', description: '', order: 2, actions: [mkAction('a-vol', 'Increase volume')] },
      ] },
      { id: 'ql-learn', title: 'Learning & Growth', description: '', icon: '📚', color: 'sapphire', quests: [
        { id: 'q-read', title: 'I — Read more', description: '', order: 1, actions: [mkAction('a-book', 'Finish the compiler book')] },
      ] },
      { id: 'ql-side', title: 'Side Projects', description: '', icon: '🛠️', color: 'violet', quests: [] },
    ],
    routines: [
      { id: 'r-read', title: 'Read 15 minutes', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, streak: 12, anchor: true },
      { id: 'r-work', title: 'Deep work, 3 hours', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, streak: 4, anchor: true },
      { id: 'r-water', title: 'Drink water', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, streak: 0, anchor: true, target: 64, progress: 16, step: 16, unit: 'oz' },
      { id: 'r-gym', title: 'Go to Gym 3 times', description: '', recurring: 'weekly', completed: false, trackedToday: true, lastResetAt: now, streak: 0, anchor: true, target: 3, progress: 0 },
      { id: 'r-gymlink', title: 'Gym session', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, streak: 2, questlineId: 'ql-health' },
      // Pinned deliberately: a General one-off (no questline, no system, not an
      // anchor) no longer reaches Today on its due date alone — it waits to be
      // pinned there. The checks below are about rendering, reordering and the
      // tray count, so the fixture puts it on the list the way a user now would.
      { id: 'r-notes', title: 'Write up notes', description: '', recurring: null, completed: false, trackedToday: true, lastResetAt: now,
        subtasks: [{ id: 's-out', title: 'Outline', completed: false }, { id: 's-draft', title: 'Draft', completed: false }] },
    ],
    completionLog: {},
    taskHistory: {},
    todoOrder: {},
  };
  // Six months of aggregate history plus per-task history for the consistency panel.
  const today = new Date();
  const key = d => { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0, 10); };
  for (let i = 0; i < 120; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (i % 7 !== 3) state.completionLog[key(d)] = 1 + (i % 4);
  }
  const hist = (id, keepIf) => {
    const days = [];
    for (let i = 45; i >= 1; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      if (keepIf(i)) days.push(key(d));
    }
    state.taskHistory[id] = days;
  };
  hist('r-read', () => true);                 // never missed
  hist('r-work', i => i % 2 === 0);           // every other day
  hist('r-water', i => i > 20);               // stopped three weeks ago
  hist('r-gymlink', i => i % 3 === 0);
  hist('r-gym', i => i % 4 === 0);
  return JSON.stringify({ state, version: 0 });
}

app.whenReady().then(async () => {
  tray.init(() => {});

  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: {
      preload: path.join(REPO, 'electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false,
      // A hidden window throttles rAF, which stalls framer's exit animations —
      // "has the toast gone" would otherwise fail for reasons unrelated to the app.
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', e => {
    const msg = typeof e === 'object' && e.message ? e.message : '';
    const lvl = typeof e === 'object' && e.level !== undefined ? e.level : 0;
    if (lvl >= 3 && !msg.includes('Content-Security-Policy')) errors.push(msg);
  });

  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => fs.writeFileSync(path.join(OUT, name), (await win.webContents.capturePage()).toPNG());

  await win.loadFile(path.join(REPO, 'dist', 'index.html'));
  await sleep(1800);

  // Seed real-shaped data and reload into it.
  await js(`localStorage.setItem('milestone-v1', ${JSON.stringify(fixture())}); true`);
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await sleep(2500);

  // ── 1. The Today refactor still renders and still reorders ────────────────
  const today = await js(`(() => ({
    rows: document.querySelectorAll('.task-row').length,
    chips: [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\\n/g, ' ')),
    handleIsButton: document.querySelector('.task-row button[aria-label^="Reorder"]') !== null,
    checkboxLabelled: !!document.querySelector('.task-row input[type=checkbox]')?.getAttribute('aria-label'),
    counter: document.body.innerText.includes('16/64 oz'),
  }))()`);
  check('Today still renders after the split', today.rows >= 6, `${today.rows} rows`);
  // Read from the source constant rather than a copy of the string, so the
  // assertion tracks a rename instead of quietly going stale against it.
  check('category chips still derive', today.chips.some(c => c.includes(ANCHOR_LABEL)), today.chips.join(' | '));
  check('drag handle is still a focusable button', today.handleIsButton);
  check('row checkbox still has an accessible name', today.checkboxLabelled);
  check('counter control still renders', today.counter);

  await js(`window.__q = () => JSON.parse(localStorage.getItem('milestone-v1')).state; true`);

  const titles = () => js(`[...document.querySelectorAll('.task-row button[aria-label^="Reorder"]')]
    .map(b => b.getAttribute('aria-label').replace(/^Reorder /, '').replace(/\\. Press.*$/, ''))`);
  const before = await titles();
  await js(`(() => {
    const h = document.querySelector('.task-row button[aria-label^="Reorder"]');
    h.focus();
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  })()`);
  await sleep(700);
  const after = await titles();
  check('keyboard reorder survives the refactor', before[0] === after[1] && before[1] === after[0],
        `${before[0]} <-> ${before[1]}`);
  await shot('A-today.png');

  // -- 1b. Session strip and checkpoint pips --------------------------------
  const rowOf = title => `[...document.querySelectorAll('.task-row')].find(r => r.innerText.includes(${JSON.stringify(title)}))`;

  const gym = await js(`(() => {
    const row = ${rowOf('Go to Gym 3 times')};
    if (!row) return { found: false };
    const pips = [...row.querySelectorAll('button[aria-pressed]')];
    return {
      found: true,
      pips: pips.length,
      labels: pips.map(p => p.textContent).join(''),
      disabled: pips.filter(p => p.disabled).length,
      caption: row.textContent,
    };
  })()`);
  check('the gym goal grows a week strip', gym.found && gym.pips === 7, gym.pips + ' pips "' + gym.labels + '"');
  check('the strip reads Sunday to Saturday', gym.labels === 'SMTWTFS', gym.labels);
  check('days that have not happened are not tappable', gym.disabled > 0, gym.disabled + ' disabled');
  check('it says how many sessions the cycle wants', /0\/3 this cycle/.test(gym.caption || ''), (gym.caption || '').slice(0, 140));

  // The whole point: tapping one day three times must not finish a 3x week.
  const tapped = await js(`(() => {
    const row = ${rowOf('Go to Gym 3 times')};
    const today = [...row.querySelectorAll('button[aria-pressed]')].filter(p => !p.disabled).pop();
    today.click(); today.click(); today.click();
    return true;
  })()`);
  await sleep(800);
  const afterTaps = await js(`(() => {
    const r = __q().routines.find(x => x.id === 'r-gym');
    return { progress: r.progress, days: r.sessionDays || [], completed: r.completed };
  })()`);
  check('three taps on one day cannot finish a 3x week', tapped && afterTaps.progress === 1 && !afterTaps.completed,
        JSON.stringify(afterTaps));
  check('exactly one day is logged', afterTaps.days.length === 1, afterTaps.days.join(','));

  // Backfilling an earlier day credits that day, not today.
  const backfilled = await js(`(() => {
    const row = ${rowOf('Go to Gym 3 times')};
    const pips = [...row.querySelectorAll('button[aria-pressed]')].filter(p => !p.disabled);
    if (pips.length < 2) return { skipped: true };
    pips[0].click();
    return { skipped: false, day: pips[0].getAttribute('aria-label').split(':')[0].replace(/ .*$/, '') };
  })()`);
  await sleep(800);
  const afterBackfill = await js(`(() => {
    const s = __q();
    const r = s.routines.find(x => x.id === 'r-gym');
    return { progress: r.progress, days: r.sessionDays || [], log: s.completionLog, history: s.taskHistory['r-gym'] || [] };
  })()`);
  if (backfilled.skipped) {
    check('an earlier day can be backfilled', true, 'skipped - today is the first day of the cycle');
  } else {
    check('an earlier day can be backfilled', afterBackfill.progress === 2, afterBackfill.days.join(','));
    check('the backfill credits the day it happened', afterBackfill.log[backfilled.day] === 1 && afterBackfill.history.includes(backfilled.day),
          backfilled.day + ' -> log ' + afterBackfill.log[backfilled.day] + ', history ' + afterBackfill.history.join(','));
  }

  // Water: four rungs, tap the third for 48.
  const water = await js(`(() => {
    const row = ${rowOf('Drink water')};
    if (!row) return { found: false };
    const pips = [...row.querySelectorAll('button[aria-pressed]')];
    return { found: true, pips: pips.length, labels: pips.map(p => p.textContent).join(' ') };
  })()`);
  check('the water counter grows a checkpoint ladder', water.found && water.pips === 4, water.pips + ' pips: ' + water.labels);
  check('the rungs are the checkpoints', water.labels === '16 32 48 64', water.labels);

  await js(`(() => { [...${rowOf('Drink water')}.querySelectorAll('button[aria-pressed]')][2].click(); return true; })()`);
  await sleep(800);
  const afterRung = await js(`__q().routines.find(x => x.id === 'r-water').progress`);
  check('tapping the third rung jumps straight to 48', afterRung === 48, 'progress ' + afterRung);

  // A plain checkbox habit must grow nothing at all.
  const plain = await js(`${rowOf('Read 15 minutes')}.querySelectorAll('button[aria-pressed]').length`);
  check('an ordinary habit grows no strip', plain === 0, plain + ' pips');
  await shot('I-strips.png');

  // ── 2. The per-habit history panel is gone; the streak carries that meaning ──
  const noPanel = await js(`[...document.querySelectorAll('.parchment')].some(p => p.innerText.startsWith('Consistency'))`);
  check('no per-habit history panel under Today', noPanel === false, 'panel present: ' + noPanel);

  // ── 3. Undo ───────────────────────────────────────────────────────────────
  await js(`location.hash = '#/quests'`);
  await sleep(1400);

  // The questline ✕ only exists in edit mode, and only while its header is
  // hovered — so put the page in the state a real user would be in.
  const enterEditMode = async () => {
    await js(`(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Edit');
      if (b) b.click();
      return true;
    })()`);
    await sleep(500);
  };
  const clickDeleteQuestline = () => js(`(() => {
    // React delegates onMouseEnter from a bubbling mouseover.
    for (const h of document.querySelectorAll('[class*=parchment] > div, .parchment')) {
      h.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
    return true;
  })()`).then(() => sleep(350)).then(() => js(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Delete questline');
    if (!btn) return { clicked: false, buttons: [...document.querySelectorAll('button')].map(b => b.title).filter(Boolean).join(',') };
    btn.click();
    return { clicked: true };
  })()`));

  await enterEditMode();
  const deleted = await clickDeleteQuestline();
  await sleep(700);
  const undoState = await js(`(() => {
    const toast = document.querySelector('[role=status]');
    const s = __q();
    return {
      toast: !!toast,
      label: toast?.innerText.split('\\n')[0],
      questlines: s.questlines.length,
      routines: s.routines.length,
    };
  })()`);
  check('deleting a questline offers an undo', deleted.clicked && undoState.toast, undoState.label);
  check('the toast names the cascade', /·.*quest/.test(undoState.label ?? ''), undoState.label);
  check('the cascade actually happened', undoState.questlines === 2 && undoState.routines === 5,
        `${undoState.questlines} questlines, ${undoState.routines} routines`);
  await shot('B-undo-toast.png');

  const restored = await js(`(() => {
    const b = [...document.querySelectorAll('[role=status] button')].find(b => b.textContent === 'Undo');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  // Sample the toast over time: a stuck element and a slow animation look the
  // same in one reading.
  const trace = await js(`(async () => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const t = document.querySelector('[role=status]');
      out.push(t ? getComputedStyle(t).opacity : 'gone');
      await new Promise(r => setTimeout(r, 300));
    }
    return out.join(' ');
  })()`);
  say('      toast opacity trace: ' + JSON.stringify(trace));
  await sleep(600);
  const afterUndo = await js(`(() => {
    const s = __q();
    return {
      questlines: s.questlines.map(q => q.id),
      routines: s.routines.map(r => r.id),
      quests: s.questlines[0]?.quests.length ?? 0,
      toasts: [...document.querySelectorAll('[role=status]')].map(t => t.textContent.slice(0, 40) + ' @' + getComputedStyle(t).opacity),
    };
  })()`);
  check('undo restores the questline in place', restored && afterUndo.questlines[0] === 'ql-health',
        afterUndo.questlines.join(','));
  check('undo restores the linked routine at its index', afterUndo.routines.join(',') === 'r-read,r-work,r-water,r-gym,r-gymlink,r-notes',
        afterUndo.routines.join(','));
  check('undo restores the nested quests', afterUndo.quests === 2, `${afterUndo.quests} quests`);
  check('the toast clears itself after undoing', afterUndo.toasts.length === 0, afterUndo.toasts.join(' ;; '));

  // Ctrl+Z, the thing everyone tries first.
  await clickDeleteQuestline();
  await sleep(500);
  await js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); true`);
  await sleep(600);
  const ctrlZ = await js(`__q().questlines.length`);
  check('Ctrl+Z runs the undo', ctrlZ === 3, `${ctrlZ} questlines`);

  // ── 4. Search palette ─────────────────────────────────────────────────────
  await js(`location.hash = '#/'`);
  await sleep(1200);
  // Dispatched at `window`, which is a target a real key event can genuinely have
  // and which has no `closest` — the handler has to survive that, not throw and
  // take the shortcut down for the rest of the session.
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); true`);
  await sleep(800);
  const opened = await js(`document.querySelectorAll('[role=dialog][aria-label=Search]').length`);
  check('slash opens the palette, even from a non-element target', opened === 1, `${opened} dialogs`);

  const typed = await js(`(() => {
    const input = document.querySelector('[role=dialog][aria-label=Search] input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'squat');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const hits = await js(`(() => {
    const rows = [...document.querySelectorAll('[role=dialog][aria-label=Search] [data-active]')];
    return { count: rows.length, first: rows[0]?.innerText.replace(/\\n/g, ' | ') };
  })()`);
  check('typing searches across questlines', typed && hits.count >= 1, JSON.stringify(hits));
  check('the result names where it lives', /Health & Fitness/.test(hits.first ?? ''), hits.first);
  await shot('C-palette.png');

  const navigated = await js(`(() => {
    const input = document.querySelector('[role=dialog][aria-label=Search] input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  await sleep(1200);
  const dest = await js(`({
    hash: location.hash,
    dialogs: [...document.querySelectorAll('[role=dialog][aria-label=Search]')].map(d => getComputedStyle(d).opacity),
  })`);
  check('Enter navigates to the containing page', navigated && dest.hash.includes('questline/ql-health'), dest.hash);
  check('choosing a result closes the palette', dest.dialogs.length === 0, dest.dialogs.join(','));

  // ── 5. Reminders + tray IPC ───────────────────────────────────────────────
  await js(`location.hash = '#/'`);
  await sleep(1200);
  const bell = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === '🔔');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(1600);
  const modal = await js(`(() => {
    const panel = document.querySelector('.modal-overlay .parchment');
    const t = (panel?.innerText ?? '').replace(/\\n/g, ' | ');
    return { open: !!panel, heading: panel?.querySelector('h2')?.textContent, text: t };
  })()`);
  check('the reminders panel opens', bell && modal.open, modal.heading);
  check('it reports what is actually still open', /5 of 5 still open right now/.test(modal.text), modal.head);
  check('the tray setting is offered on desktop', /Keep running in the tray/.test(modal.text), `len=${modal.text.length} tail=${modal.text.slice(-220)}`);
  await shot('D-reminders.png');

  const tested = await js(`(() => {
    [...document.querySelectorAll('.modal-overlay button')].find(b => b.textContent.includes('Send a test')).click();
    return true;
  })()`);
  await sleep(1200);
  check('the test button reaches the notification IPC', tested && notifyCalls.length === 1,
        JSON.stringify(notifyCalls[0]));
  check('the notification names real tasks', /Read 15 minutes/.test(notifyCalls[0]?.body ?? ''), notifyCalls[0]?.body);
  check('the tray receives the open count', trayCalls.length > 0 && trayCalls.at(-1).count === 5,
        `${trayCalls.length} calls, last ${JSON.stringify(trayCalls.at(-1))}`);
  check('the real tray module accepts the update', tray.update({ count: 3, keepInTray: false }).ok !== undefined);
  check('close-to-tray stays off until asked', tray.shouldHideOnClose() === false);
  check('close-to-tray engages when asked', (tray.update({ count: 1, keepInTray: true }), tray.shouldHideOnClose() === true));
  tray.update({ count: 0, keepInTray: false });

  // Close the modal so it can't sit over the next screenshot.
  await js(`(() => { const b = [...document.querySelectorAll('.modal-overlay button')].find(b => b.textContent === 'Close'); if (b) b.click(); return true; })()`);
  await sleep(600);

  // ── 6. Desktop backups still round-trip ───────────────────────────────────
  await js(`window.dispatchEvent(new Event('beforeunload')); true`);
  await sleep(1200);
  const onDisk = backups.list();
  check('a snapshot still lands on disk', onDisk.length > 0,
        onDisk.map(b => `${b.name} (${b.questlines}ql/${b.routines}r)`).join(', '));
  check('path traversal is still rejected', backups.read('../../evil.json').ok === false);

  // ── 7. The browser build: no preload, so the IndexedDB path is the one used ─
  const webWin = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },   // no preload = no electronAPI
  });
  const webErrors = [];
  webWin.webContents.on('console-message', e => {
    const msg = typeof e === 'object' && e.message ? e.message : '';
    const lvl = typeof e === 'object' && e.level !== undefined ? e.level : 0;
    if (lvl >= 3 && !msg.includes('Content-Security-Policy')) webErrors.push(msg);
  });
  const wjs = code => webWin.webContents.executeJavaScript(code, true);

  await webWin.loadFile(path.join(REPO, 'dist', 'index.html'));
  await sleep(1500);
  await wjs(`localStorage.setItem('milestone-v1', ${JSON.stringify(fixture())}); true`);
  webWin.webContents.reload();
  await new Promise(r => webWin.webContents.once('did-finish-load', r));
  await sleep(2500);

  check('the web build has no bridge, as intended', (await wjs(`!window.electronAPI`)));

  await wjs(`[...document.querySelectorAll('button')].find(b => b.title === 'Export / Import data').click()`);
  await sleep(2200);
  const webCard = await wjs(`(() => {
    const panel = document.querySelector('.modal-overlay .parchment');
    const text = panel?.innerText ?? '';
    return {
      open: !!panel,
      hasCard: text.includes('Automatic backups'),
      warnsAboutBrowser: /clearing site data/i.test(text),
      body: text.replace(/\\n/g, ' | ').slice(0, 400),
    };
  })()`);
  check('the web build now shows automatic backups', webCard.open && webCard.hasCard, webCard.body?.slice(0, 140));
  check('and says plainly that they die with site data', webCard.warnsAboutBrowser);
  fs.writeFileSync(path.join(OUT, 'E-web-backups.png'), (await webWin.webContents.capturePage()).toPNG());

  const snap = await wjs(`(async () => {
    const btn = [...document.querySelectorAll('.modal-overlay button')].find(b => b.textContent === 'Back up now');
    btn.click();
    await new Promise(r => setTimeout(r, 1200));
    const panel = document.querySelector('.modal-overlay .parchment');
    return panel.innerText.replace(/\\n/g, ' | ');
  })()`);
  check('taking a snapshot in the browser works', /questlines, 6 tasks/.test(snap), snap.slice(0, 180));

  // Straight at IndexedDB, to prove the bytes really landed rather than the UI
  // merely claiming they did.
  const idb = await wjs(`(() => new Promise(resolve => {
    const req = indexedDB.open('milestone-backups');
    req.onsuccess = () => {
      const db = req.result;
      const all = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
      all.onsuccess = () => {
        const rows = all.result;
        resolve({
          count: rows.length,
          name: rows[0]?.name,
          questlines: rows[0]?.questlines,
          parses: (() => { try { return !!JSON.parse(rows[0].bundle.quest).state.questlines.length; } catch { return false; } })(),
        });
      };
      all.onerror = () => resolve({ count: -1 });
    };
    req.onerror = () => resolve({ count: -2 });
  }))()`);
  check('the snapshot is really in IndexedDB', idb.count > 0, JSON.stringify(idb));
  check('and reads back as a valid bundle', idb.parses === true && idb.questlines === 3, JSON.stringify(idb));

  const restoreWeb = await wjs(`(async () => {
    [...document.querySelectorAll('.modal-overlay button')].find(b => b.textContent.startsWith('Restore')).click();
    await new Promise(r => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('.modal-overlay button')].filter(b => b.textContent === 'Restore');
    return { listed: rows.length };
  })()`);
  check('the browser restore picker lists its snapshots', restoreWeb.listed > 0, JSON.stringify(restoreWeb));

  say('\nDESKTOP CONSOLE ERRORS: ' + (errors.length ? JSON.stringify(errors, null, 1) : 'none'));
  say('WEB CONSOLE ERRORS: ' + (webErrors.length ? JSON.stringify(webErrors, null, 1) : 'none'));
  const failed = results.filter(r => !r.pass);
  say(`\n${results.length - failed.length}/${results.length} checks passed`);
  bail(failed.length || errors.length || webErrors.length ? 1 : 0);
}).catch(e => { say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2); });
