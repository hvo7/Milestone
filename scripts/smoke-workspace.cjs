/* Run with Electron, never the real application main. Only synthetic data in a
 * fresh temporary profile; show:false keeps the test window off the desktop. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
const out = process.env.MILESTONE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-workspace-shots-'));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-workspace-test-')));
const timer = setTimeout(() => { console.error('Smoke test timed out'); app.exit(2); }, 90000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 1050, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', e => { if (e.level >= 3 && !e.message.includes('Content-Security-Policy')) errors.push(e.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label) => {
    for (let i = 0; i < 80; i++) { if (await js(code)) return; await pause(75); }
    throw new Error(`Timed out: ${label}`);
  };
  const go = async (route, condition) => { await js(`location.hash = ${JSON.stringify(route)}`); await pause(150); await waitFor(condition, route); await pause(800); };
  const click = async code => { assert.equal(await js(`(() => { const el = ${code}; if (!el) return false; el.click(); return true; })()`), true, `Missing ${code}`); await pause(200); };
  const shot = async name => { await pause(400); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const state = () => js(`JSON.parse(localStorage.getItem('milestone-v1')).state`);
  const now = new Date().toISOString();
  const logical = new Date(Date.now() - 5 * 3600000);
  const day = `${logical.getFullYear()}-${String(logical.getMonth() + 1).padStart(2, '0')}-${String(logical.getDate()).padStart(2, '0')}`;
  const fixture = {
    questlines: [
      { id: 'marathon', title: 'Run a marathon', description: 'Complete my first marathon.', icon: '🏃', color: 'emerald', sequential: true, quests: [
        { id: '5k', title: 'My first 5K', description: 'Finish a 5K event.', completionMode: 'manual', order: 1, actions: [{ id: 'register', title: 'Register for the 5K', completed: false, trackedToday: true }] },
        { id: '10k', title: 'My first 10K', description: '', order: 2, actions: [] },
      ] },
      { id: 'korean', title: 'Learn conversational Korean', description: '', icon: '📖', color: 'sapphire', quests: [{ id: 'hangul', title: 'Learn Hangul', description: '', order: 1, actions: [] }] },
    ],
    systems: [
      { id: 'running', title: 'Running practice', questlineId: 'marathon' },
      { id: 'shared', title: 'Shared practice', questIds: ['5k', 'hangul'] },
      { id: 'foundation', title: 'Daily foundations' },
    ],
    routines: [
      { id: 'mile', title: 'Run one mile', recurring: 'daily', completed: false, trackedToday: true, anchor: true, systemId: 'running', lastResetAt: now, streak: 4 },
      { id: 'room', title: 'Reset my room', recurring: 'daily', completed: false, trackedToday: true, anchor: true, systemIds: ['foundation'], lastResetAt: now },
      { id: 'outside', title: 'Get outside', recurring: 'daily', completed: true, completedAt: now, trackedToday: true, anchor: true, lastResetAt: now },
      { id: 'strength', title: 'Strength & mobility', recurring: 'weekly', target: 2, progress: 0, sessionDays: [], completed: false, trackedToday: true, systemIds: ['running'], lastResetAt: now },
      { id: 'airport', title: 'Pick up my brother from the airport', recurring: null, completed: false, trackedToday: true, dueDate: day, lastResetAt: now },
      { id: 'old-car', title: 'Car repair completed in 2024', recurring: null, completed: true, completedAt: '2024-01-01T12:00:00.000Z', trackedToday: false, lastResetAt: now, subtasks: [{ id: 'old-step', title: 'Collect car', completed: true }] },
    ],
    completionLog: { '2024-01-01': 1, [day]: 1 }, taskHistory: { 'old-car': ['2024-01-01'], outside: [day] }, todoOrder: {}, anchorSystemRetired: true,
  };
  await win.loadFile(path.join(root, 'dist', 'index.html'));
  await pause(500);
  await js(`localStorage.setItem('milestone-v1', ${JSON.stringify(JSON.stringify({ state: fixture, version: 0 }))}); true`);
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload(); await loaded;
  await waitFor(`!!document.querySelector('.today-rail')`, 'Today rail');
  await pause(500);
  const before = await state();
  const todayStyle = await js(`(() => { const el = document.querySelector('.today-rail'); const s = getComputedStyle(el); return [s.width,s.marginTop,s.position,getComputedStyle(document.querySelector('.water-cover')).minHeight]; })()`);
  assert(before.routines.some(r => r.id === 'old-car'));
  assert.deepEqual(before.taskHistory['old-car'], ['2024-01-01']);
  await shot('today');
  await go('/quests?questline=marathon', `document.querySelector('.questline-sidebar')?.textContent.includes('Run a marathon') && document.querySelector('.questline-main')?.textContent.includes('Supporting systems')`);
  assert.equal(await js(`document.querySelectorAll('.questline-sidebar .questline-nav-item').length`), 3);
  assert(await js(`document.querySelector('.questline-main').textContent.includes('Running practice')`));
  await shot('quests');
  await go('/systems?questline=marathon', `document.querySelector('.questline-main')?.textContent.includes('Running practice') && !!document.querySelector('[aria-label="Edit system Running practice"]')`);
  assert(await js(`document.querySelector('.questline-main').textContent.includes('Shared practice')`));
  assert.equal(await js(`!!document.querySelector('[aria-label="Edit system Daily foundations"]')`), false);
  await shot('systems');
  await go('/systems?questline=korean', `document.querySelector('.questline-main')?.textContent.includes('Practices supporting this questline.') && !document.querySelector('[aria-label="Edit system Running practice"]')`);
  assert(await js(`document.querySelector('.questline-main').textContent.includes('Shared practice')`));
  await go('/systems?view=general', `!!document.querySelector('[aria-label="Edit system Daily foundations"]')`);
  assert.equal(await js(`!!document.querySelector('[aria-label="Edit system Shared practice"]')`), false);
  assert.deepEqual(await state(), before, 'Navigation must not migrate, refile, or change records');
  await go('/systems?questline=marathon', `!!document.querySelector('input[aria-label="Run one mile"]')`);
  await click(`document.querySelector('input[aria-label="Run one mile"]')`);
  assert.equal((await state()).routines.find(r => r.id === 'mile').completed, true);
  await go('/', `!!document.querySelector('.today-rail')`);
  assert.equal(await js(`document.querySelectorAll('input[aria-label="Run one mile"]').length`), 1);
  assert.equal(await js(`document.querySelector('.today-rail input[aria-label="Run one mile"]').checked`), true);
  assert.deepEqual(await js(`(() => { const el = document.querySelector('.today-rail'); const s = getComputedStyle(el); return [s.width,s.marginTop,s.position,getComputedStyle(document.querySelector('.water-cover')).minHeight]; })()`), todayStyle, 'Workspace styles must not change Today');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key:'z', ctrlKey:true, bubbles:true })); true`);
  assert.equal((await state()).routines.find(r => r.id === 'mile').completed, false, 'Undo shared completion');
  await go('/systems?questline=marathon', `!!document.querySelector('[aria-label="Edit system Running practice"]')`);
  await click(`[...document.querySelectorAll('section[aria-label="Running practice"] button')].find(b => b.title === '+1')`);
  const afterSession = await state();
  assert.equal(afterSession.routines.find(r => r.id === 'strength').progress, 1);
  assert.equal(afterSession.routines.find(r => r.id === 'strength').completed, false);
  assert.deepEqual(afterSession.routines.find(r => r.id === 'strength').sessionDays, [day]);
  await go('/quests?view=general', `document.querySelector('.questline-main')?.textContent.includes('tasks, errands')`);
  assert(await js(`document.querySelector('.questline-main').textContent.includes('Pick up my brother')`));
  await click(`[...document.querySelectorAll('.questline-main button')].find(b => b.textContent.includes('Completed history'))`);
  assert(await js(`document.querySelector('.questline-main').textContent.includes('Car repair completed in 2024')`));
  await go('/questline/marathon', `location.hash.includes('/quests?questline=marathon') && document.querySelector('.questline-main')?.textContent.includes('My first 5K')`);
  await click(`document.querySelector('button[aria-label="Mark achieved: My first 5K"]')`);
  const afterAchievement = await state();
  assert.equal(afterAchievement.questlines[0].quests[0].completed, true);
  assert.equal(afterAchievement.questlines[0].quests[0].actions[0].completed, false, 'Achievement must not rewrite steps');
  for (const route of ['/quests?questline=marathon', '/systems?view=all', '/']) {
    win.setSize(390, 900);
    await go(route, route === '/' ? `!!document.querySelector('.today-rail')` : `!!document.querySelector('.questline-sidebar')`);
    assert(await js(`document.documentElement.scrollWidth <= innerWidth + 1`), `Horizontal overflow on ${route}`);
    await shot(route === '/' ? 'today-mobile' : route.startsWith('/quests') ? 'quests-mobile' : 'systems-mobile');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, checks: ['non-mutating navigation', 'legacy and quest-only links', 'General', 'shared spotlight completion', 'undo', 'weekly sessions', 'retained archive/history', 'bookmarked routes', 'independent achievement', 'Today styles', '390px layouts'], screenshots: out }, null, 2));
  console.log('PASS: workspace navigation, shared completion/undo, sessions, archive preservation, achievement and responsive layouts.');
  console.log(`Screenshots: ${out}`);
  clearTimeout(timer); app.exit(0);
}).catch(error => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: false, error: error.stack || String(error) }, null, 2)); console.error(error.stack || error); clearTimeout(timer); app.exit(1); });
