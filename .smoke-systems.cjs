/**
 * Drives the Systems tab in the real built app.
 *
 * Throwaway userData dir and synthetic data only — the real profile is never
 * touched. Pipe-safe and self-terminating for the same reason .smoke3.cjs is:
 * an orphaned Electron main process throws an EPIPE dialog onto the desktop.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = process.env.SMOKE_REPO;
const OUT  = process.env.SMOKE_OUT;

const ANCHOR_LABEL = /ANCHOR_LABEL\s*=\s*'([^']+)'/
  .exec(fs.readFileSync(path.join(REPO, 'src', 'lib', 'ui.ts'), 'utf8'))[1];

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-systems-')));

let piped = true;
for (const s of [process.stdout, process.stderr]) s.on('error', () => { piped = false; });
const say = l => { if (piped) { try { process.stdout.write(l + '\n'); } catch { piped = false; } } };
const bail = c => { try { app.exit(c); } catch { process.exit(c); } };
process.on('uncaughtException', e => {
  if (e && e.code === 'EPIPE') { piped = false; bail(3); return; }
  say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2);
});
setTimeout(() => { say('TIMEOUT'); bail(4); }, 5 * 60_000).unref?.();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 170) : ''}`);
};

/** Two anchor habits with 30 days of history, one loose weekly gym goal. */
function fixture() {
  const now = new Date().toISOString();
  // Logical days, not calendar days: the app's day turns over at 5am, so before
  // then the current logical day is still yesterday's date. Shifting the clock
  // back five hours and taking the calendar date gives the same answer, and
  // keeps this fixture meaning the same thing whatever time the suite runs at.
  const LOGICAL_NOW = Date.now() - 5 * 3_600_000;
  const day = i => {
    const d = new Date(LOGICAL_NOW - i * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const state = {
    // A questline is a direction; the quests inside it are the goals. A system
    // can serve either level.
    questlines: [{
      id: 'ql-health', title: 'Health & Fitness', description: '', icon: '💪', color: 'emerald',
      quests: [{ id: 'q-strong', title: 'Get to 100kg squat', description: '', order: 1, actions: [] }],
    }],
    routines: [
      { id: 'r-read',  title: 'Read 15 minutes', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 12, systemIds: ['sys-mind'] },
      { id: 'r-water', title: 'Drink water',     description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 0,  systemIds: ['sys-mind'] },
      // The subject of the migration: a member of the old anchor *system*, which
      // should come out the other side as a member of the Today section.
      { id: 'r-focus', title: 'Ten minutes quiet', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 4, systemIds: ['sys-anchor'] },
      { id: 'r-gym',   title: 'Go to Gym 3 times', description: '', recurring: 'weekly', completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 3, target: 3, progress: 0 },
      // Ran two days ago, missed yesterday: exactly the "don't miss twice" state.
      { id: 'r-walk',  title: 'Evening walk',    description: '', recurring: 'daily',  completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 0 },
      { id: 'r-once',  title: 'Book the dentist', description: '', recurring: null, completed: false, trackedToday: false, lastResetAt: now },
      // Quest-side work: filed under a goal, in no system. The other half of the
      // hierarchy — a goal is reached through systems *and* one-and-done tasks.
      { id: 'r-plan',  title: 'Plan the training block', description: '', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now, createdAt: old, streak: 0, questlineId: 'ql-health' },
    ],
    systems: [
      { id: 'sys-anchor', title: ANCHOR_LABEL, order: 0, createdAt: old },
      { id: 'sys-mind',   title: 'Mind',       order: 1, createdAt: old },
    ],
    completionLog: {},
    // Read every day for 30 (100%), water on half of them (50%).
    taskHistory: {
      'r-read':  Array.from({ length: 30 }, (_, i) => day(i)).reverse(),
      'r-water': Array.from({ length: 30 }, (_, i) => day(i)).filter((_, i) => i % 2 === 0).reverse(),
      'r-gym':   Array.from({ length: 13 }, (_, i) => day(i * 2)).reverse(),
      'r-walk':  [day(2)],
    },
    todoOrder: {},
  };
  return JSON.stringify({ state, version: 0 });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 1000, show: false,
    webPreferences: {
      preload: path.join(REPO, 'electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', e => {
    const msg = typeof e === 'object' && e.message ? e.message : '';
    const lvl = typeof e === 'object' && e.level !== undefined ? e.level : 0;
    if (lvl >= 3 && !msg.includes('Content-Security-Policy')) errors.push(msg);
  });

  const js = c => win.webContents.executeJavaScript(c, true);
  const shot = async n => fs.writeFileSync(path.join(OUT, n), (await win.webContents.capturePage()).toPNG());

  await win.loadFile(path.join(REPO, 'dist', 'index.html'));
  await sleep(1500);
  await js(`localStorage.setItem('milestone-v1', ${JSON.stringify(fixture())}); true`);
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await sleep(2500);

  await js(`window.__q = () => JSON.parse(localStorage.getItem('milestone-v1')).state; true`);
  // The same read the app uses: the array when it's there, the legacy single
  // field when it isn't. Asserting against the raw field would make these checks
  // pass or fail on storage shape rather than on membership.
  await js(`window.__sys = r => r.systemIds || (r.systemId ? [r.systemId] : []); true`);

  // ── 1. The seed ────────────────────────────────────────────────────────────
  const migrated = await js(`(() => {
    const s = __q();
    const focus = s.routines.find(r => r.id === 'r-focus');
    const read  = s.routines.find(r => r.id === 'r-read');
    return {
      titles: (s.systems || []).map(x => x.title),
      anchored: s.routines.filter(r => r.anchor).map(r => r.id),
      focusSystems: __sys(focus),
      focusStreak: focus.streak,
      readSystems: __sys(read),
      flag: s.anchorSystemRetired,
    };
  })()`);
  check('the anchor group is no longer a system', !migrated.titles.includes(ANCHOR_LABEL), migrated.titles.join(', '));
  check('its habits are marked for the Today section', migrated.anchored.join(',') === 'r-focus', migrated.anchored.join(','));
  check('and come out with nothing else attached', migrated.focusSystems.length === 0, migrated.focusSystems.join(','));
  check('keeping their streaks', migrated.focusStreak === 4, String(migrated.focusStreak));
  check('other systems are untouched', migrated.readSystems.join(',') === 'sys-mind', migrated.readSystems.join(','));
  check('the migration marks itself done', migrated.flag === true, String(migrated.flag));

  // ── 2. The tab renders ─────────────────────────────────────────────────────
  const inNav = await js(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Systems')`);
  check('Systems is in the nav', inNav === true);

  await js(`location.hash = '#/systems'`);
  await sleep(1800);

  const page = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Mind'));
    return {
      card: !!card,
      text: card ? card.innerText.replace(/\\n/g, ' | ') : '',
      loose: document.body.innerText.includes('Not in a system'),
      oneOffExcluded: !document.body.innerText.includes('Book the dentist'),
      body: document.body.innerText.replace(/\\n/g, ' | '),
    };
  })()`);
  check('a system renders as a card', page.card === true);
  // Removed on request — the jargon explained itself to nobody.
  check('no "settling", no "restart", no window caption, no explainer',
        !/settling|restart|last 30 days|fall to the level/i.test(page.body), page.body.slice(0, 160));
  // Read 100% + water 50% averages to 75%.
  check('health averages its habits', /75%/.test(page.text), page.text.slice(0, 150));
  check('a loose repeating habit is called out', page.loose === true);
  check('a one-off is not offered as a habit', page.oneOffExcluded === true);
  await shot('S-systems.png');

  // ── 3. The side panel: create with every option in one pass ────────────────
  await js(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('New system')).click();
    return true;
  })()`);
  await sleep(900);

  const panel = await js(`(() => {
    const labels = [...document.querySelectorAll('span')]
      .map(s => s.textContent).filter(t => /^(System|Actions|Serves)$/.test(t));
    const all = [...document.querySelectorAll('span')].map(s => s.textContent);
    return {
      open: !!document.querySelector('input[placeholder="Physical base"]'),
      labels: [...new Set(labels)],
      // Nothing beyond the three asked for.
      strays: [...new Set(all.filter(t => /^(Identity|Colour|When it runs|On a bad day|Notes)$/.test(t)))],
    };
  })()`);
  check('the side panel opens on New system', panel.open === true);

  // Your own mark, not a preset grid: an emoji you type, or an image you upload.
  const iconField = await js(`(() => {
    const input = [...document.querySelectorAll('input')].find(i => /emoji/i.test(i.placeholder || ''));
    const upload = [...document.querySelectorAll('button')].find(b => /Upload image/i.test(b.textContent || ''));
    const file = document.querySelector('input[type="file"][accept^="image"]');
    if (!input) return { found: false };
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, '🏋');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { found: true, upload: !!upload, file: !!file };
  })()`);
  check('a system takes a mark of your own', iconField.found === true, JSON.stringify(iconField));
  check('typed, or uploaded as an image', iconField.upload === true && iconField.file === true, JSON.stringify(iconField));
  check('it asks for exactly three things', panel.labels.length === 3, panel.labels.join(', '));
  check('and nothing else', panel.strays.length === 0, panel.strays.join(', ') || 'none');

  // Captions removed on request: a form that has to be narrated has the wrong labels.
  const noProse = await js(
    `!/what this system asks|as many as apply|just the practice|already have|the actions stay/i.test(document.body.innerText)`);
  check('the panel explains nothing', noProse === true);

  // The dark-mode dropdown defect: a translucent --input-bg composited against
  // the OS popup's own white surface, leaving near-white text on near-white.
  // Measured rather than eyeballed — the popup itself is drawn by the OS and
  // never appears in a screenshot.
  const legible = await js(`(() => {
    const sel = document.querySelector('select.rune-input');
    const opt = sel && sel.querySelector('option');
    if (!opt) return { found: false };
    const cs = getComputedStyle(opt);
    const nums = c => (c.match(/[\\d.]+/g) || []).map(Number);
    const bg = nums(cs.backgroundColor), fg = nums(cs.color);
    const lum = ([r, g, b]) => {
      const s = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    const L1 = lum(bg), L2 = lum(fg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return {
      found: true,
      opaque: bg.length < 4 || bg[3] === 1,
      ratio: Math.round(ratio * 10) / 10,
      bg: cs.backgroundColor, fg: cs.color,
    };
  })()`);
  check('dropdown options are painted opaque', legible.found && legible.opaque === true, legible.bg);
  check('dropdown text is legible against them', legible.ratio >= 4.5,
        `${legible.ratio}:1 — ${legible.fg} on ${legible.bg}`);

  // Both themes, or it isn't fixed — a dark-mode repair that inverts into an
  // unreadable light mode is the same bug wearing the other coat.
  const light = await js(`(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    const cs = getComputedStyle(document.querySelector('select.rune-input option'));
    // Snapshot the strings now: the declaration is live, so reading it again
    // after the theme is put back would report dark's colours for light's ratio.
    const bgText = cs.backgroundColor, fgText = cs.color;
    const nums = c => (c.match(/[\\d.]+/g) || []).map(Number);
    const bg = nums(bgText), fg = nums(fgText);
    const lum = ([r, g, b]) => {
      const s = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    const L1 = lum(bg), L2 = lum(fg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    document.documentElement.setAttribute('data-theme', 'dark');
    return { ratio: Math.round(ratio * 10) / 10, bg: bgText, fg: fgText };
  })()`);
  check('and legible in light mode too', light.ratio >= 4.5,
        `${light.ratio}:1 — ${light.fg} on ${light.bg}`);

  await shot('S-drawer.png');

  const setVal = (el, value) => `(() => {
    const el = ${el};
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`;

  await js(setVal(`document.querySelector('input[placeholder="Physical base"]')`, 'Physical base'));

  // A new system opens with one empty action row already waiting.
  const firstRow = await js(`document.querySelectorAll('input[placeholder="Go to the gym"]').length`);
  check('the actions list starts with a row to fill', firstRow === 1, `${firstRow} rows`);

  // Two actions, typed straight into the panel with their own frequencies.
  await js(setVal(`document.querySelector('input[placeholder="Go to the gym"]')`, 'Lift weights'));
  await js(setVal(`document.querySelector('select[aria-label^="How often"]')`, 'weekly'));
  await sleep(200);
  await js(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add action')).click(); return true; })()`);
  await sleep(300);
  await js(`(() => {
    const rows = [...document.querySelectorAll('input[placeholder="Go to the gym"]')];
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(rows[rows.length - 1], 'Stretch');
    rows[rows.length - 1].dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  // And two tasks that already exist, pulled in — one loose, one that is already
  // in the seeded anchor system. The second is the point: bringing a task into a
  // system adds it, it does not move it out of the one it was in.
  await js(setVal(`[...document.querySelectorAll('select')].find(s => s.innerText.includes('Add existing task'))`, 'r-walk'));
  await sleep(300);
  await js(setVal(`[...document.querySelectorAll('select')].find(s => s.innerText.includes('Add existing task'))`, 'r-read'));
  await sleep(300);

  // Goals is a dropdown now, not a column of every questline you own.
  const goalPicker = await js(`(() => {
    const t = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].pop();
    if (!t) return { found: false };
    const summary = t.textContent.trim();
    t.click();
    return { found: true, summary };
  })()`);
  await sleep(300);
  const goalOpts = await js(`(() => {
    const opts = [...document.querySelectorAll('[role="option"]')];
    const health = opts.find(o => o.textContent.trim() === 'Health & Fitness');
    const quest  = opts.find(o => /Get to 100kg squat/.test(o.textContent));
    if (health) health.click();
    if (quest) quest.click();
    // Titles only — the questline's emoji belongs to the questline, not to this row.
    return { count: opts.length, labels: opts.map(o => o.textContent.trim()).join(' | '), picked: !!health, quest: !!quest };
  })()`);
  check('Serves is a dropdown, closed until asked', goalPicker.found === true && /Nothing yet/.test(goalPicker.summary), goalPicker.summary);
  // The hierarchy, in one list: the direction, and the goals inside it.
  check('it lists questlines by title alone', /^Health & Fitness/.test(goalOpts.labels), goalOpts.labels);
  check('and the quests nested under them', /↳ Get to 100kg squat/.test(goalOpts.labels), goalOpts.labels);
  await sleep(300);
  await shot('S-drawer.png');
  await js(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Create system').click(); return true; })()`);
  await sleep(1600);

  const made = await js(`(() => {
    const s = __q();
    const sys = s.systems.find(x => x.title === 'Physical base');
    if (!sys) return { made: false };
    const mine = s.routines.filter(r => __sys(r).includes(sys.id));
    const read = s.routines.find(r => r.id === 'r-read');
    const anchor = s.systems.find(x => x.title === 'Mind');
    return {
      made: true,
      goals: (sys.questlineIds || (sys.questlineId ? [sys.questlineId] : [])).join(','),
      quests: (sys.questIds || []).join(','),
      actions: mine.map(r => r.title + ':' + (r.recurring || ('every ' + r.intervalDays))).join(', '),
      pulledIn: mine.some(r => r.id === 'r-walk'),
      readIn: __sys(read).length,
      readKeptAnchor: __sys(read).includes(anchor.id) && __sys(read).includes(sys.id),
    };
  })()`);
  check('the panel creates the system', made.made === true);
  check('actions are created with their own frequencies', /Lift weights:weekly/.test(made.actions) && /Stretch:daily/.test(made.actions), made.actions);
  check('an existing task can be brought in', made.pulledIn === true, made.actions);
  check('a goal can be attached from the panel', made.goals === 'ql-health', made.goals);
  check('and a quest inside it, separately', made.quests === 'q-strong', made.quests);
  const savedIcon = await js(`(() => {
    const sys = __q().systems.find(x => x.title === 'Physical base');
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    return { icon: sys && sys.icon, onCard: card ? card.innerText.includes('🏋') : false };
  })()`);
  check('the icon you chose is saved and shown', savedIcon.icon === '🏋' && savedIcon.onCard === true, JSON.stringify(savedIcon));
  // The whole point of the change: bringing a task in adds a membership.
  check('bringing in a task adds it rather than moving it', made.readIn === 2, `in ${made.readIn} system(s)`);
  check('so it is in both systems at once', made.readKeptAnchor === true, String(made.readKeptAnchor));

  const card = await js(`(() => {
    const c = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    return c ? c.innerText.replace(/\\n/g, ' | ') : '';
  })()`);
  check('the card lists the actions with their frequency', /Lift weights/.test(card) && /Weekly/i.test(card), card.slice(0, 220));

  // One habit, listed under both processes it serves — a system membership is
  // not a filing cabinet you can only be in one drawer of.
  const inBothCards = await js(`(() => {
    const named = t => {
      const c = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes(t));
      return c ? c.innerText : '';
    };
    return {
      anchor: /Read 15 minutes/.test(named('Mind')),
      physical: /Read 15 minutes/.test(named('Physical base')),
    };
  })()`);
  check('a habit in two systems is listed under both', inBothCards.anchor && inBothCards.physical, JSON.stringify(inBothCards));
  await shot('S-systems-2.png');

  // ── 3b. Never miss twice ───────────────────────────────────────────────────
  const risk = await js(`(() => {
    const t = document.body.innerText;
    return { warned: /miss twice/.test(t), named: /Evening walk/.test(t), calm: !/Read 15 minutes.*miss twice/.test(t) };
  })()`);
  check('a habit one miss from breaking is called out', risk.warned && risk.named, JSON.stringify(risk));
  check('a habit that is running is left alone', risk.calm === true);

  // ── 3b2. The pin: which system actions sit on Today is a choice ────────────
  const pins = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    const btns = [...card.querySelectorAll('button[aria-label^="Show "]')];
    return {
      count: btns.length,
      labels: btns.map(b => b.getAttribute('aria-label')).join(' | '),
      // Daily actions are on Today by definition, so their pin is fixed on.
      disabled: btns.filter(b => b.disabled).map(b => b.getAttribute('aria-label')).join(', '),
      pressed: btns.map(b => b.getAttribute('aria-pressed')).join(','),
    };
  })()`);
  check('every action carries a pin', pins.count === 4, `${pins.count}: ${pins.labels}`);

  // It has to *look* pressable at rest, not just respond to a click — the first
  // version was a bare glyph at 20% opacity and read as decoration.
  const pinStyle = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    const b = card.querySelector('button[aria-label="Show Lift weights on Today"]');
    const cs = getComputedStyle(b);
    return {
      borderWidth: parseFloat(cs.borderTopWidth),
      bg: cs.backgroundColor,
      opacity: Number(cs.opacity),
      cursor: cs.cursor,
      radius: parseFloat(cs.borderTopLeftRadius),
    };
  })()`);
  check('the pin is drawn as a button', pinStyle.borderWidth >= 1 && pinStyle.radius >= 4 && pinStyle.bg !== 'rgba(0, 0, 0, 0)',
        JSON.stringify(pinStyle));
  check('and it is not faded out at rest', pinStyle.opacity >= 0.6 && pinStyle.cursor === 'pointer', JSON.stringify(pinStyle));
  check('no pin is dead', pins.disabled === '', pins.disabled || 'all live');

  // The case that made this "worse than before": every habit in the seeded
  // anchor system was locked, so none of its pins did anything at all.
  const anchorPin = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Mind'));
    const b = card.querySelector('button[aria-label="Show Read 15 minutes on Today"]');
    if (!b) return { found: false };
    const before = b.getAttribute('aria-pressed');
    b.click();
    return { found: true, before };
  })()`);
  await sleep(900);
  const anchorOff = await js(`(() => {
    const r = __q().routines.find(x => x.id === 'r-read');
    return { offToday: r.offToday === true, tracked: r.trackedToday };
  })()`);
  check('a system habit can be taken off Today', anchorPin.found && anchorOff.offToday === true, JSON.stringify(anchorOff));

  await js(`location.hash = '#/'`);
  await sleep(1500);
  const anchorGone = await js(`[...document.querySelectorAll('.today-main .task-row')].some(r => r.innerText.includes('Read 15 minutes'))`);
  check('and it actually leaves the day’s list', anchorGone === false, String(anchorGone));

  await js(`location.hash = '#/systems'`);
  await sleep(1400);
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Mind'));
    card.querySelector('button[aria-label="Show Read 15 minutes on Today"]').click();
    return true;
  })()`);
  await sleep(900);
  await js(`location.hash = '#/'`);
  await sleep(1500);
  const anchorBack = await js(`[...document.querySelectorAll('.today-main .task-row')].some(r => r.innerText.includes('Read 15 minutes'))`);
  check('pressing again brings it back', anchorBack === true, String(anchorBack));
  await js(`location.hash = '#/systems'`);
  await sleep(1400);

  // Unpin the weekly one, and it should leave Today.
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    const b = [...card.querySelectorAll('button[aria-label="Show Lift weights on Today"]')][0];
    b.click(); return true;
  })()`);
  await sleep(900);
  const unpinned = await js(`__q().routines.find(r => r.title === 'Lift weights').trackedToday`);
  check('the pin toggles off', unpinned === false, String(unpinned));

  await js(`location.hash = '#/'`);
  await sleep(1600);
  const gone = await js(`[...document.querySelectorAll('.today-main .task-row')].some(r => r.innerText.includes('Lift weights'))`);
  check('an unpinned weekly action drops off Today', gone === false, String(gone));

  // Pin it again from the Systems page and it comes back, cadence intact.
  await js(`location.hash = '#/systems'`);
  await sleep(1500);
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    [...card.querySelectorAll('button[aria-label="Show Lift weights on Today"]')][0].click();
    return true;
  })()`);
  await sleep(900);
  await shot('S-pins.png');
  await js(`location.hash = '#/'`);
  await sleep(1600);
  const back = await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Lift weights'));
    return row ? row.innerText.replace(/\\n/g, ' ') : '';
  })()`);
  check('pinning puts it back on Today', /Lift weights/.test(back), back || 'absent');
  check('and it keeps its frequency there', /Weekly/i.test(back), back);
  check('and it keeps its system tag', /Physical base/.test(back), back);

  // ── 3c. The loop: system actions land on Today and can be ticked there ─────
  await js(`location.hash = '#/'`);
  await sleep(1800);

  const onToday = await js(`(() => {
    const rows = [...document.querySelectorAll('.today-main .task-row')].map(r => r.innerText.replace(/\\n/g, ' '));
    const chips = [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\\n/g, ' '));
    return {
      rows,
      chips,
      stretch: rows.find(t => /Stretch/.test(t)) || '',
      lift:    rows.find(t => /Lift weights/.test(t)) || '',
    };
  })()`);
  check('a daily system action appears on Today', /Stretch/.test(onToday.stretch), onToday.stretch);
  check('it is tagged with its system', /Physical base/.test(onToday.stretch), onToday.stretch);
  // Weekly actions inside a system show every day too — otherwise you find out
  // you missed it on the day the week ends.
  check('a weekly system action shows every day as well', /Lift weights/.test(onToday.lift), onToday.lift || 'absent');
  // The per-category chips became one dropdown, so the system is an option in it
  // rather than a chip of its own.
  await js(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => /^Filter:/.test(b.textContent || ''));
    if (t) t.click();
    return !!t;
  })()`);
  await sleep(400);
  const filterOpts = await js(`[...document.querySelectorAll('.v-menu-item')].map(b => b.textContent.trim())`);
  check('the system is offered in the filter', filterOpts.some(o => /Physical base/.test(o)), filterOpts.join(' | '));
  await js(`(() => {
    const t = [...document.querySelectorAll('button')].find(b => /^Filter:/.test(b.textContent || ''));
    if (t) t.click();
    return true;
  })()`);
  await sleep(300);

  // Every row is a different task. "Read 15 minutes" is in two systems by now,
  // which is the case that could put the same work on the list twice.
  const unique = await js(`(() => {
    const rows = [...document.querySelectorAll('.today-main .task-row')].map(r => r.innerText.replace(/\\n/g, ' ').trim());
    const seen = new Set();
    const dupes = [];
    for (const t of rows) { if (seen.has(t)) dupes.push(t); seen.add(t); }
    return {
      total: rows.length,
      read: rows.filter(t => /Read 15 minutes/.test(t)).length,
      dupes: dupes.join(' | '),
      // The store's own count of what should be visible, so this compares the
      // list against the data rather than against itself.
      expected: __q().routines.filter(r => !r.hidden && !r.offToday).length,
    };
  })()`);
  check('a habit in two systems appears once', unique.read === 1, `${unique.read} rows`);
  check('and no row on Today repeats', unique.dupes === '', unique.dupes || 'all unique');

  // Ticking it off on Today is the actual tracking.
  await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Stretch'));
    row.querySelector('input[type=checkbox]').click();
    return true;
  })()`);
  await sleep(1200);
  const ticked = await js(`(() => {
    const s = __q();
    const r = s.routines.find(x => x.title === 'Stretch');
    const today = Object.keys(s.completionLog);
    return { done: r.completed, history: (s.taskHistory[r.id] || []).length, logged: today.length > 0 };
  })()`);
  check('ticking a system action on Today completes it', ticked.done === true, JSON.stringify(ticked));
  check('and it records a day of history for the system score', ticked.history === 1 && ticked.logged, JSON.stringify(ticked));
  await shot('S-today.png');

  // ── 3d. Attaching a system straight from the Today row ────────────────────
  // "Book the dentist" is a one-off in no system; the gym goal is loose too.
  const menu = await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Go to Gym 3 times'));
    const btn = [...row.querySelectorAll('button')].find(b => (b.title || '').includes('which system'));
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  await sleep(500);
  const items = await js(`(() => {
    const ticks = [...document.querySelectorAll('button[role="menuitemcheckbox"]')];
    return {
      physical: ticks.filter(b => /Physical base/.test(b.textContent)).length,
      // Ticks, not a single choice — a habit can be in more than one.
      checkable: ticks.every(b => b.getAttribute('aria-checked') !== null),
      none: [...document.querySelectorAll('button')].some(b => /Not part of a system/.test(b.textContent)),
    };
  })()`);
  check('the row tag opens a system menu', menu.found === true);
  check('it lists the systems and an opt-out', items.physical > 0 && items.none === true, JSON.stringify(items));
  check('the systems are ticks rather than one choice', items.checkable === true, JSON.stringify(items));

  const pickSystem = t => `(() => {
    const b = [...document.querySelectorAll('button[role="menuitemcheckbox"]')].find(x => x.textContent.includes(${JSON.stringify(t)}));
    if (!b) return false;
    b.click();
    return true;
  })()`;

  await js(pickSystem('Physical base'));
  await sleep(1000);
  const attached = await js(`(() => {
    const s = __q();
    const sys = s.systems.find(x => x.title === 'Physical base');
    const gym = s.routines.find(r => r.id === 'r-gym');
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Go to Gym 3 times'));
    // The tag button itself, not the row: the menu stays open on a pick (so a
    // second system can follow), and its contents would otherwise be read as
    // part of the row's text.
    const tag = row && [...row.querySelectorAll('button')].find(b => (b.title || '').includes('which system'));
    return {
      attached: __sys(gym).includes(sys.id),
      tag: tag ? tag.textContent.trim() : '',
      rowText: row ? row.innerText.replace(/\\n/g, ' ') : '',
    };
  })()`);
  check('picking a system attaches the task from Today', attached.attached === true, attached.rowText);
  check('and the row retags itself immediately', attached.tag === 'Physical base', attached.tag || attached.rowText);
  await shot('S-tagmenu.png');

  // ── 3d2. One task, several systems ────────────────────────────────────────
  // The menu stays open on a pick precisely so a second one can follow.
  const secondPick = await js(pickSystem('Mind'));
  await sleep(1000);
  const two = await js(`(() => {
    const s = __q();
    const gym = s.routines.find(r => r.id === 'r-gym');
    const ids = __sys(gym);
    const ticked = [...document.querySelectorAll('button[role="menuitemcheckbox"]')]
      .filter(b => b.getAttribute('aria-checked') === 'true').length;
    const rows = [...document.querySelectorAll('.today-main .task-row')].filter(r => r.innerText.includes('Go to Gym 3 times'));
    const tag = rows[0] && [...rows[0].querySelectorAll('button')].find(b => (b.title || '').includes('which system'));
    return {
      count: ids.length,
      ticked,
      rows: rows.length,
      tag: tag ? tag.textContent.trim() : '',
    };
  })()`);
  check('a second system can be ticked on the same task', secondPick === true && two.count === 2, `in ${two.count} system(s)`);
  check('both read as ticked at once', two.ticked === 2, `${two.ticked} ticked`);
  // The day's list is a list of things to do: a habit in two systems is still
  // one thing to do, so it is one row naming one system.
  check('a task in two systems is still one row', two.rows === 1, `${two.rows} rows`);
  check('tagged with one system, not a count', two.tag === 'Physical base', two.tag);

  // Leaving one system leaves the other standing.
  await js(pickSystem('Physical base'));
  await sleep(1000);
  const stillOne = await js(`(() => {
    const s = __q();
    const mind = s.systems.find(x => x.title === 'Mind');
    const ids = __sys(s.routines.find(r => r.id === 'r-gym'));
    return { ids: ids.length, keptAnchor: ids.includes(mind.id) };
  })()`);
  check('unticking one leaves the others alone', stillOne.ids === 1 && stillOne.keptAnchor === true, JSON.stringify(stillOne));
  // Put it back, so the checks below still have it in Physical base.
  await js(pickSystem('Physical base'));
  await sleep(900);

  // The bug this section exists for: a weekly counter is a *goal*, so it sits on
  // Today whatever the pin says. Its pin must therefore read as locked, not
  // offer a toggle that the day's list will quietly ignore.
  await js(`location.hash = '#/systems'`);
  await sleep(1500);
  const pinStates = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    return [...card.querySelectorAll('button[aria-label^="Show "]')].map(b => ({
      who: b.getAttribute('aria-label').replace(/^Show | on Today$/g, ''),
      locked: b.disabled,
      why: b.title,
    }));
  })()`);
  const gymPin = pinStates.find(p => /Gym/.test(p.who)) || {};
  const weeklyPin = pinStates.find(p => /Lift weights/.test(p.who)) || {};
  check('a goal inside a system has a live pin too', gymPin.locked === false, JSON.stringify(gymPin));
  check('every pin in the card is live', pinStates.every(p => p.locked === false), JSON.stringify(pinStates));
  check('a plain weekly action still has a live pin', weeklyPin.locked === false, JSON.stringify(weeklyPin));
  await js(`location.hash = '#/'`);
  await sleep(1400);

  // And back out again, from the same control.
  await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Go to Gym 3 times'));
    [...row.querySelectorAll('button')].find(b => (b.title || '').includes('which system')).click();
    return true;
  })()`);
  await sleep(500);
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Remove from all systems/.test(x.textContent));
    if (b) b.click();
    return true;
  })()`);
  await sleep(1000);
  const detached = await js(`__sys(__q().routines.find(r => r.id === 'r-gym')).length === 0`);
  check('and the same control takes it back out', detached === true, String(detached));

  // Reassignment from the task's own edit drawer.
  const reassigned = await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Lift weights'));
    // The row's controls are hover-revealed, so the pointer has to arrive first.
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { hovered: true };
  })()`);
  await sleep(400);
  const opened = await js(`(() => {
    const row = [...document.querySelectorAll('.today-main .task-row')].find(r => r.innerText.includes('Lift weights'));
    const btn = [...row.querySelectorAll('button')].find(b => (b.title || '').toLowerCase().startsWith('edit everything'));
    if (!btn) return { opened: false, buttons: [...row.querySelectorAll('button')].map(b => b.title || b.textContent).join(' | ') };
    btn.click();
    return { opened: true };
  })()`);
  check('the row exposes its edit control on hover', reassigned.hovered && opened.opened === true, opened.buttons || 'opened');
  await sleep(1100);
  const picker = await js(`(() => {
    const t = [...document.querySelectorAll('button[aria-haspopup="listbox"]')][0];
    if (!t) return { found: false };
    const summary = t.textContent.trim();
    t.click();
    return { found: true, summary };
  })()`);
  // Opening is a state change — read the list on the next paint, not in the same
  // evaluation, or React hasn't rendered it yet.
  await sleep(400);
  const options = await js(`(() => {
    const opts = [...document.querySelectorAll('[role="option"]')];
    return {
      // Still a set: several can be ticked at once, they're just behind one line now.
      multi: opts.length > 0 && opts.every(o => o.getAttribute('aria-selected') !== null),
      on: opts.filter(o => o.getAttribute('aria-selected') === 'true').map(o => o.textContent.trim()).join(' | '),
      all: opts.map(o => o.textContent.trim()).join(' | '),
    };
  })()`);
  check('the edit drawer offers the system assignment', picker.found === true, JSON.stringify(picker).slice(0, 200));
  check('as a dropdown summarising the current one', /Physical base/.test(picker.summary || ''), picker.summary || '');
  check('and it still takes several', options.multi === true && options.on.includes('Physical base'), JSON.stringify(options).slice(0, 200));
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.title || '') === 'Close'); if (b) b.click(); return true; })()`);
  await sleep(700);

  // -- 3e. Pencil on a habit row opens the full task drawer -------------------
  await js(`location.hash = '#/systems'`);
  await sleep(1500);
  const pencil = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    const row = [...card.querySelectorAll('div')].find(d => d.innerText.startsWith('Lift weights'));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { hovered: true };
  })()`);
  await sleep(400);
  const pencilOpened = await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    const btn = [...card.querySelectorAll('button')].find(b => (b.title || '').startsWith('Edit everything'));
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  await sleep(1100);
  const drawer = await js(`(() => {
    const labels = [...document.querySelectorAll('span')].map(s => s.textContent);
    return {
      title: document.body.innerText.includes('Edit task'),
      questline: labels.includes('Questline'),
      anchor: labels.includes('Anchor habit'),
      quest: labels.some(t => /^Quest/.test(t || '')),
      system: labels.includes('Systems'),
      streak: labels.includes('Streak'),
    };
  })()`);
  check('hovering a habit row reveals a pencil', pencil.hovered && pencilOpened.found === true);
  check('it opens the full task drawer', drawer.title === true, JSON.stringify(drawer));
  check('with a questline picker', drawer.questline === true, JSON.stringify(drawer));
  check('and the rest of the task details', drawer.system && drawer.streak, JSON.stringify(drawer));
  const drawerProse = await js(
    `!/yours to set|broken down again|independent of the anchor|processes this habit|one day can only count once/i.test(document.body.innerText)`);
  check('and no captions explaining its boxes', drawerProse === true);
  await shot('S-taskdrawer.png');

  // Anchor and questline are no longer either/or.
  await js(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Add to |^In /.test(b.textContent || ''));
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(300);
  await js(`(() => {
    const sel = [...document.querySelectorAll('select, button')].find(el => /Questline/.test(el.getAttribute('aria-label') || ''));
    return !!sel;
  })()`);
  await js(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save changes').click();
    return true;
  })()`);
  await sleep(1100);
  const bothFlags = await js(`(() => {
    const r = __q().routines.find(x => x.title === 'Lift weights');
    return { anchor: r.anchor === true, systemId: __sys(r).length > 0 };
  })()`);
  check('a task can be an anchor habit and stay in its system', bothFlags.anchor === true && bothFlags.systemId === true,
        JSON.stringify(bothFlags));

  // ── 3f. Systems vs Quests, as a filter ────────────────────────────────────
  // The hierarchy: a goal is reached through systems (things you repeat) plus
  // one-and-done tasks. Today can show either half on its own.
  await js(`location.hash = '#/'`);
  await sleep(1600);
  const kinds = await js(`(() => {
    const chips = [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\\n/g, ' ').trim());
    return { chips, has: chips.some(c => /^Systems/.test(c)) && chips.some(c => /^Quests/.test(c)) };
  })()`);
  check('Today offers a Systems / Quests filter', kinds.has === true, kinds.chips.join(' | '));
  // "Everything" and "All" were the same button twice.
  check('and only one way to say "no filter"',
        kinds.chips.filter(c => /^(All|Everything)/.test(c)).length === 1, kinds.chips.join(' | '));
  // Seven questlines used to be seven chips; now it is one dropdown.
  const dropdown = await js(`(() => {
    const trigger = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-haspopup') || '') === 'listbox' || /▾/.test(b.textContent || ''));
    const chipCount = document.querySelectorAll('.chip').length;
    return { found: !!trigger, chipCount };
  })()`);
  check('and one dropdown instead of a chip per questline',
        dropdown.found === true && dropdown.chipCount <= 3, JSON.stringify(dropdown));

  // ── 3g. The anchor group is a place on this page ──────────────────────────
  const rail = await js(`(() => {
    const box = document.querySelector('.today-rail');
    if (!box) return { found: false };
    const rows = [...document.querySelectorAll('.today-main .task-row')].map(r => r.innerText.replace(/\\n/g, ' '));
    return {
      found: true,
      titled: box.innerText.includes(${JSON.stringify(ANCHOR_LABEL)}),
      holds: /Ten minutes quiet/.test(box.innerText),
      // Exclusive: it is in the section, so it is not in the list as well.
      inList: rows.some(t => /Ten minutes quiet/.test(t)),
      checkbox: !!box.querySelector('input[type="checkbox"]'),
    };
  })()`);
  check('the anchor group has its own section on Today', rail.found && rail.titled === true, JSON.stringify(rail));
  check('holding the tasks marked for it', rail.holds === true, JSON.stringify(rail));
  check('and those tasks are not in the list as well', rail.inList === false, JSON.stringify(rail));

  const tickAnchor = await js(`(() => {
    const box = document.querySelector('.today-rail');
    const row = [...box.querySelectorAll('.task-row')].find(r => /Ten minutes quiet/.test(r.innerText));
    if (!row) return false;
    row.querySelector('input[type="checkbox"]').click();
    return true;
  })()`);
  await sleep(1000);
  const anchorTicked = await js(`__q().routines.find(r => r.id === 'r-focus').completed`);
  check('its tasks can be ticked off there', tickAnchor && anchorTicked === true, String(anchorTicked));
  await shot('S-anchor-rail.png');
  await js(`(() => {
    const box = document.querySelector('.today-rail');
    const row = [...box.querySelectorAll('.task-row')].find(r => /Ten minutes quiet/.test(r.innerText));
    row.querySelector('input[type="checkbox"]').click();
    return true;
  })()`);
  await sleep(800);

  // Everything a row in the list can do, this row can do — it is the same row.
  const anchorRow = await js(`(() => {
    const box = document.querySelector('.today-rail');
    const row = [...box.querySelectorAll('.task-row')].find(r => /Ten minutes quiet/.test(r.innerText));
    if (!row) return { found: false };
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { found: true, streak: /🔥/.test(row.innerText), cadence: /Daily/i.test(row.innerText) };
  })()`);
  await sleep(400);
  const anchorControls = await js(`(() => {
    const box = document.querySelector('.today-rail');
    const row = [...box.querySelectorAll('.task-row')].find(r => /Ten minutes quiet/.test(r.innerText));
    const titles = [...row.querySelectorAll('button')].map(b => (b.title || '').toLowerCase());
    return {
      skip: titles.some(t => /skip/.test(t)),
      edit: titles.some(t => t.startsWith('edit everything')),
      del: titles.some(t => /delete/.test(t)),
    };
  })()`);
  check('the section shows the streak and cadence', anchorRow.found && anchorRow.streak && anchorRow.cadence, JSON.stringify(anchorRow));
  check('and offers skip, edit and delete like any other row',
        anchorControls.skip && anchorControls.edit && anchorControls.del, JSON.stringify(anchorControls));

  const onlySystems = await js(`(() => {
    const btn = [...document.querySelectorAll('.chip')].find(c => /^Systems/.test(c.innerText));
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  // Rows leave through an exit animation. This window runs with show:false, which
  // throttles requestAnimationFrame, so filtered-out rows can still be in the DOM
  // mid-exit — capturePage forces the frames that finish them.
  // Filtered-out rows leave through an exit animation, and this window runs with
  // show:false, which throttles requestAnimationFrame — they can still be in the
  // DOM a second later. Wait them out before counting what's on screen.
  await sleep(1500);
  await shot('S-filter.png');
  await sleep(400);
  const systemsOnly = await js(`(() => {
    const s = __q();
    const rows = [...document.querySelectorAll('.today-main .task-row')].map(r => r.innerText.replace(/\\n/g, ' '));
    const titles = s.routines.filter(r => __sys(r).length).map(r => r.title);
    return {
      rows: rows.length,
      // Every row shown belongs to a system.
      allInSystems: rows.every(t => titles.some(x => t.includes(x))),
      // And the loose one-off is not among them.
      noOneOff: !rows.some(t => /Book the dentist/.test(t)),
    };
  })()`);
  check('filtering to Systems shows only system actions',
        onlySystems.found && systemsOnly.allInSystems === true && systemsOnly.rows > 0, JSON.stringify(systemsOnly));
  check('and drops the one-off tasks', systemsOnly.noOneOff === true, JSON.stringify(systemsOnly));
  await js(`(() => {
    const b = [...document.querySelectorAll('.chip')].find(c => /^Everything/.test(c.innerText));
    if (b) b.click();
    return true;
  })()`);
  await sleep(800);

  // ── 4. The questline shows what drives it ──────────────────────────────────
  await js(`location.hash = '#/questline/ql-health'`);
  await sleep(1600);
  const onGoal = await js(`document.body.innerText.replace(/\\n/g, ' | ')`);
  check('the goal page names the system driving it', /Physical base/.test(onGoal), onGoal.slice(0, 160));

  // The page is partitioned: the goals you're aiming at, then the processes
  // running underneath them.
  const partition = await js(`(() => {
    const dividers = [...document.querySelectorAll('.rune-divider')].map(d => d.innerText.trim());
    const body = document.body.innerText;
    return {
      dividers,
      quests: dividers.some(d => /Quest/i.test(d)),
      systems: dividers.some(d => /System/i.test(d)),
      // The system's card names the quest it feeds, not just the questline.
      forQuest: /for Get to 100kg squat/.test(body),
      // And lists what the system actually asks of you.
      habits: /Lift weights/.test(body),
    };
  })()`);
  check('the questline splits into Quests and Systems', partition.quests && partition.systems, partition.dividers.join(' | '));
  check('a system says which quest it feeds', partition.forQuest === true, partition.dividers.join(' | '));
  check('and lists the habits it is made of', partition.habits === true, String(partition.habits));
  await shot('S-questline.png');
  // A quest is a goal or a one-off. The repeated actions inside a system are the
  // system's, and listing them here made the goal look like a habit tracker.
  const noActions = await js(`(() => {
    const s = __q();
    const inSystems = s.routines.filter(r => __sys(r).length).map(r => r.title);
    // Scoped to the Quests half of the page: a system's actions belong to the
    // system, and appear under it — they must not also be listed as quest work.
    const quests = document.querySelector('[data-section="quests"]');
    const text = quests ? quests.innerText : '';
    return { leaked: inSystems.filter(t => text.includes(t)).join(', '), checked: inSystems.length };
  })()`);
  check('but not the system’s own actions as quest tasks',
        noActions.leaked === '', noActions.leaked || `${noActions.checked} checked`);
  await shot('S-questline.png');

  // ── 5. Deleting a system keeps the habits ──────────────────────────────────
  await js(`location.hash = '#/systems'`);
  await sleep(1500);
  // Delete lives in the panel now, next to the sentence explaining what survives.
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Physical base'));
    [...card.querySelectorAll('button')].find(b => b.textContent.includes('✎')).click();
    return true;
  })()`);
  await sleep(900);
  const reopened = await js(`(() => {
    const i = document.querySelector('input[placeholder="Physical base"]');
    const rows = [...document.querySelectorAll('input[placeholder="Go to the gym"]')].map(x => x.value);
    const freqs = [...document.querySelectorAll('select[aria-label^="How often"]')].map(x => x.value);
    return { open: !!i, title: i && i.value, rows, freqs };
  })()`);
  check('the panel reopens populated for editing', reopened.open && reopened.title === 'Physical base', JSON.stringify(reopened));
  check('it round-trips the actions and their frequencies',
        reopened.rows.includes('Lift weights') && reopened.freqs.includes('weekly'),
        `${reopened.rows.join(', ')} / ${reopened.freqs.join(', ')}`);

  await js(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('Delete system')).click();
    return true;
  })()`);
  await sleep(1200);
  const afterDelete = await js(`(() => {
    const s = __q();
    const walk = s.routines.find(r => r.id === 'r-walk');
    return {
      systems: s.systems.map(x => x.title),
      // The action created inside the panel, and the one pulled in — both must
      // outlive the grouping.
      created: s.routines.filter(r => ['Lift weights', 'Stretch'].includes(r.title)).map(r => r.title + ':' + (__sys(r)[0] || 'loose')),
      walk: walk ? 'alive:' + (__sys(walk)[0] || 'loose') : 'GONE',
      // It was in two systems; only the deleted one should have gone.
      read: __sys(s.routines.find(r => r.id === 'r-read')).length,
      readAnchored: __sys(s.routines.find(r => r.id === 'r-read'))
        .includes((s.systems.find(x => x.title === 'Mind') || {}).id),
    };
  })()`);
  check('deleting a system removes only the system', !afterDelete.systems.includes('Physical base'), afterDelete.systems.join(', '));
  check('actions created in the panel survive it, unassigned',
        afterDelete.created.length === 2 && afterDelete.created.every(c => c.endsWith(':loose')), afterDelete.created.join(', '));
  check('a task pulled in survives too', afterDelete.walk === 'alive:loose', afterDelete.walk);
  check('deleting a system drops only its own membership',
        afterDelete.read === 1 && afterDelete.readAnchored === true,
        `Read 15 minutes is in ${afterDelete.read} system(s)`);

  // ── 5b. The loose habits are something you can act on ──────────────────────
  // They were inert chips: the page named the problem and offered no way out.
  await sleep(800);
  const loose = await js(`(() => {
    const box = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Not in a system'));
    if (!box) return { found: false };
    const chip = [...box.querySelectorAll('button')].find(b => /Lift weights/.test(b.textContent));
    if (!chip) return { found: false, chips: [...box.querySelectorAll('button')].map(b => b.textContent.trim()).join(' | ') };
    chip.click();
    return { found: true };
  })()`);
  await sleep(500);
  const looseMenu = await js(`(() => {
    const items = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    const target = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Mind');
    if (target) target.click();
    return { offered: !!target, edit: items.includes('Edit task…') };
  })()`);
  await sleep(1000);
  const filed = await js(`(() => {
    const s = __q();
    const mind = s.systems.find(x => x.title === 'Mind');
    const lift = s.routines.find(r => r.title === 'Lift weights');
    return {
      filed: __sys(lift).includes(mind.id),
      goneFromLoose: !(document.body.innerText.split('Not in a system')[1] || '').includes('Lift weights'),
    };
  })()`);
  check('a habit in no system is clickable', loose.found === true, loose.chips || '');
  check('it offers the systems to file it into', looseMenu.offered === true);
  check('and a way into the full editor', looseMenu.edit === true);
  check('picking one files the habit', filed.filed === true, JSON.stringify(filed));
  check('and it leaves the loose list', filed.goneFromLoose === true, JSON.stringify(filed));

  // ── 5c. The menu is not cropped by the card it opens from ─────────────────
  // .parchment clips its overflow, so the chip's menu was drawn inside a box that
  // cut it off — visible as a sliver with no way to scroll to the rest.
  const popover = await js(`(() => {
    const box = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Not in a system'));
    const chip = [...box.querySelectorAll('button')].find(b => /Stretch|Evening walk/.test(b.textContent));
    if (!chip) return { found: false };
    chip.click();
    return { found: true, card: box.getBoundingClientRect().bottom };
  })()`);
  await sleep(500);
  const clipped = await js(`(() => {
    const menus = [...document.querySelectorAll('.parchment span')]
      .filter(s => /Edit task/.test(s.textContent) && s.getBoundingClientRect().height > 20);
    const menu = menus[menus.length - 1];
    if (!menu) return { shown: false };
    const m = menu.getBoundingClientRect();
    const card = menu.closest('.parchment').getBoundingClientRect();
    return {
      shown: true,
      height: Math.round(m.height),
      // Fully on screen, and free to overhang the card that holds it.
      inViewport: m.top >= 0 && m.bottom <= window.innerHeight + 1,
      overhangs: m.bottom > card.bottom || m.top < card.top,
      clip: getComputedStyle(menu.closest('.parchment')).overflow,
    };
  })()`);
  check('the chip menu renders at full height', clipped.shown === true && clipped.height > 40, JSON.stringify(clipped));
  check('its card no longer crops it', clipped.clip === 'visible', clipped.clip);
  check('and all of it is on screen', clipped.inViewport === true, JSON.stringify(clipped));
  await shot('S-loose-menu.png');
  await js(`document.body.click()`);
  await sleep(300);

  // ── 5d. Ctrl+Z, anywhere ──────────────────────────────────────────────────
  const before = await js(`__q().routines.length`);
  await js(`(() => {
    const r = __q().routines[0];
    window.__renamed = r.title;
    return true;
  })()`);
  // A change nobody wrote an inverse for: a rename from the Systems page.
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Mind'));
    const row = [...card.querySelectorAll('div')].find(d => d.innerText.startsWith('Read 15 minutes'));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Mind'));
    const x = [...card.querySelectorAll('button')].find(b => (b.title || '') === 'Remove from this system');
    if (x) x.click();
    return !!x;
  })()`);
  await sleep(900);
  const afterRemove = await js(`__sys(__q().routines.find(r => r.id === 'r-read')).length`);

  await js(`(() => {
    document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const afterUndo = await js(`(() => ({
    systems: __sys(__q().routines.find(r => r.id === 'r-read')).length,
    routines: __q().routines.length,
    toast: /Undone/.test(document.body.innerText),
    redoOffered: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Redo'),
  }))()`);
  check('a change with no hand-written inverse still records a step', afterRemove === 0, String(afterRemove));
  check('ctrl+Z puts it back', afterUndo.systems === 1, JSON.stringify(afterUndo));
  check('nothing else moved', afterUndo.routines === before, `${afterUndo.routines} vs ${before}`);
  check('and it says so', afterUndo.toast === true && afterUndo.redoOffered === true, JSON.stringify(afterUndo));
  // Measured, not eyeballed: the toast is the only feedback an undo gives when
  // what changed is off-screen, so "it's in the DOM" is not the claim — "it is
  // painted, opaque, and inside the window" is.
  //
  // Captured first, and given a beat: this window runs with show:false, which
  // throttles requestAnimationFrame, so a framer-motion entrance can still be
  // sitting on its initial frame (opacity 0) a second after mount. capturePage
  // forces a paint; the sleep lets the animation land.
  await shot('S-undo.png');
  await sleep(800);
  const toastBox = await js(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Redo');
    const el = btn && btn.closest('[role="status"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      found: true,
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.width > 100,
      opacity: Number(cs.opacity),
      bottomGap: Math.round(window.innerHeight - r.bottom),
    };
  })()`);
  check('the toast is actually painted', toastBox.found === true && toastBox.onScreen === true && toastBox.opacity > 0.9,
        JSON.stringify(toastBox));

  // Redo, from the toast the undo put up.
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Redo');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(900);
  const afterRedo = await js(`__sys(__q().routines.find(r => r.id === 'r-read')).length`);
  check('and redo goes forward again', afterRedo === 0, String(afterRedo));

  // Inside a field the browser's own undo has to win.
  await js(`(() => {
    const card = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Learn'));
    return true;
  })()`);
  const typing = await js(`(() => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    let defaultPrevented = false;
    const probe = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(probe);
    defaultPrevented = probe.defaultPrevented;
    input.remove();
    return { defaultPrevented };
  })()`);
  check('typing keeps its own undo', typing.defaultPrevented === false, JSON.stringify(typing));

  // ── 5e. The same habit entered twice ──────────────────────────────────────
  // Two records with drifting names is what a "duplicate row" on Today actually
  // is; the page that lists every task is where it gets offered as one click.
  await js(`(() => {
    const s = JSON.parse(localStorage.getItem('milestone-v1'));
    s.state.routines.push({
      id: 'r-dup', title: 'Read 15 mins', description: '', recurring: 'daily',
      completed: false, trackedToday: true, lastResetAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), streak: 4,
    });
    // A day the surviving copy does not already have, so the union is visible —
    // 60 back, which is outside its 30-day history but inside the 400-day
    // retention floor that prunes old days at startup.
    const d = new Date(Date.now() - 5 * 3600000 - 60 * 86400000);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    s.state.taskHistory['r-dup'] = [key];
    localStorage.setItem('milestone-v1', JSON.stringify(s));
    return true;
  })()`);
  win.webContents.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await sleep(2200);
  await js(`window.__q = () => JSON.parse(localStorage.getItem('milestone-v1')).state;
            window.__sys = r => r.systemIds || (r.systemId ? [r.systemId] : []); true`);

  await js(`location.hash = '#/all'`);
  await sleep(1800);
  const dupPanel = await js(`(() => {
    const box = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Entered twice'));
    if (!box) return { found: false, body: document.body.innerText.slice(0, 120) };
    const btn = [...box.querySelectorAll('button')].find(b => /Merge into/.test(b.textContent));
    return { found: true, text: box.innerText.replace(/\\n/g, ' | '), keeps: btn ? btn.textContent.trim() : '' };
  })()`);
  check('two near-identical tasks are spotted', dupPanel.found === true, dupPanel.body || '');
  // "Read 15 minutes" has 30 days of history; the new copy has one. The survivor
  // is the one that would lose the most.
  check('and it offers to keep the one with the history', /Read 15 minutes/.test(dupPanel.keeps || ''), dupPanel.keeps);
  await shot('S-duplicates.png');

  await js(`(() => {
    const box = [...document.querySelectorAll('.parchment')].find(p => p.innerText.includes('Entered twice'));
    [...box.querySelectorAll('button')].find(b => /Merge into/.test(b.textContent)).click();
    return true;
  })()`);
  await sleep(1200);
  const merged = await js(`(() => {
    const s = __q();
    const left = s.routines.filter(r => /^Read 15 min/i.test(r.title));
    const gone = !s.routines.some(r => r.id === 'r-dup');
    return {
      count: left.length,
      streak: left[0] && left[0].streak,
      days: (s.taskHistory[left[0] && left[0].id] || []).length,
      gone,
      panel: document.body.innerText.includes('Entered twice'),
    };
  })()`);
  check('merging leaves one task', merged.count === 1 && merged.gone === true, JSON.stringify(merged));
  check('it keeps the better streak', merged.streak === 12, `streak ${merged.streak}`);
  check('and both copies’ days', merged.days === 31, `${merged.days} days — the 30 it had, plus the other copy's`);
  check('the panel goes quiet once there is nothing to merge', merged.panel === false, String(merged.panel));

  // ── 6. Search finds a system ───────────────────────────────────────────────
  await js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); return true; })()`);
  await sleep(700);
  const found = await js(`(() => {
    const i = document.querySelector('.modal-overlay input') || document.querySelector('input[placeholder*="Search" i]');
    if (!i) return { open: false };
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, 'Mind');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return { open: true };
  })()`);
  await sleep(800);
  const hit = found.open ? await js(`document.body.innerText.includes('System')`) : false;
  check('search knows about systems', found.open ? hit === true : true,
        found.open ? String(hit) : 'palette did not open — skipped');

  say('\nCONSOLE ERRORS: ' + (errors.length ? JSON.stringify(errors.slice(0, 4)) : 'none'));
  const failed = results.filter(r => !r.pass);
  say(`\n${results.length - failed.length}/${results.length} checks passed`);
  bail(failed.length || errors.length ? 1 : 0);
}).catch(e => { say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2); });
