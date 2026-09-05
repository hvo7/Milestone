# Changelog

Notable changes per release. The version in `package.json` is the single source
of truth — `vite.config.ts` reads it into `__APP_VERSION__`, which is the chip
beside the nav-bar brand and the line in the Data modal. Bump it with
`npm run release:patch|minor|major`, never by hand.

Dates are the date the version was set, not the date it was packaged.

## 3.1.1 — 2026-09-04

A fix to the updater itself, found while checking that the 3.1.0 self-update
really works on a real installation. It does — but it would not have on every
machine it could have landed on.

- **The script that installs an update now quotes paths the way PowerShell
  reads them.** The swap runs after the app exits, as a small PowerShell script
  with the paths written into it, and those paths were being written as JSON —
  which produces a double-quoted string, the one kind PowerShell interpolates.
  On a machine whose profile or install folder contains a `$` or a backtick,
  both of which Windows allows in a name, the path silently became a different
  path. The copy would be aimed at a directory that does not exist, fail, retry
  five times, and give up, leaving the previous version running: an app that
  never updates again and gives no sign of it, which is indistinguishable from
  an app with no updater at all. The paths are now single-quoted literals, where
  nothing inside is interpreted. As a side effect `update.log` stops printing
  every path with its backslashes doubled, which matters because that file is
  the only witness when an update does go wrong.

## 3.1.0 — 2026-09-04

Every copy of Milestone now updates itself, and there is somewhere for the
devices to meet that doesn't depend on one of them being awake. Nothing about how
data is reconciled has changed — this release is about the two things that kept
leaving a device on the wrong build or the wrong data with no sign that it had.

### The app updates itself

- **The desktop checks GitHub for a newer release**, downloads it in the
  background, and swaps it in when you next close the app — or right away from
  Sync & Backup → Updates → *Restart now*. Until now every computer was updated
  by hand (pull, build, package, install script), which in practice meant
  whichever machine you weren't sitting at was months behind.
- The swap runs as a detached script *after* the process exits, because Windows
  will not let a running executable be overwritten, and copies over the install
  rather than deleting it first: a copy that dies halfway leaves a working
  mixture of two builds, where a delete that dies halfway leaves nothing to
  start. `%APPDATA%\Milestone` is never touched — an update costs a launch at
  worst, never a questline.
- Hand-rolled rather than electron-updater, which wants electron-builder, an NSIS
  installer and a signing certificate to be at its best. Replacing the whole
  packaging story to gain an update mechanism is a much bigger change than the
  one being asked for. Same reasoning that left `sw.js` and `relay.mjs`
  dependency-free.
- **The phone and web copies reload themselves onto a new build.** The service
  worker was already replacing itself correctly, but that never changed the code
  *already running in the page* — so an installed phone app, which stays resident
  for days, went on showing the previous release until it was force-quit twice.
  It now notices within fifteen minutes, or the moment it is next opened, and
  takes the update silently while it is in the background. If a release lands
  while you are looking at the app, it says so and offers the reload rather than
  yanking the page out from under you.
- The build writes `dist/version.json`, which is how a stale app can find out it
  is stale: its own code has an old idea of what the current version is, so the
  answer has to come from something it asks. `public/sw.js` exempts that file
  from the cache for the same reason `api/` is exempt — served from the cache, it
  would confirm the app was current forever.
- **A release is now a version bump and a push.** `.github/workflows/release.yml`
  packages the Windows build and publishes it, `pages.yml` deploys the web app,
  and `relay.yml` redeploys the relay — so all three land on the same version
  from one action, with release notes taken from this file.

### Somewhere for the devices to meet

- **The relay is deployable.** `server/relay.mjs` has been the answer to "my
  devices are never awake at the same time" since 3.0.0 and it was never running
  anywhere, which is why the phone only ever synced next to an open desktop.
  There is now a `Dockerfile`, a `fly.toml` and [docs/relay.md](docs/relay.md):
  `fly deploy`, then paste the address into each device.
- `auto_stop_machines` is off deliberately. Devices hold an event stream open and
  the relay writes to it the moment a document lands; a stopped machine has no
  open streams, so every device falls back to its poll and live sync quietly
  becomes slow sync.
- The image serves the built app as well as the documents, so the phone installs
  Milestone from the relay and gets every subsequent build from it.
- Nothing about the protocol moved. The relay still stores one opaque document
  per device, still merges nothing, and still has no idea what a task is.

### Also

- Sync & Backup gained an **Updates** card — which build this is, whether it's
  the current one, and a button for when "within six hours" isn't soon enough.
- `electron/semver.cjs` is its own tested module because comparing the versions
  as strings would have made 3.0.10 older than 3.0.9, and that release would
  simply never have installed anywhere, with nothing to report.

## 3.0.3 — 2026-09-01

A review pass over 3.0.2 and the service worker it touched, then a second one
over the phone itself — and the two devices now update each other as it happens
rather than when they next think to ask.

### The two screens keep up with each other

- **Changes are pushed, not waited for.** Both servers now hold an event stream
  open per device (`GET /api/events`) and write to it the moment a document
  lands; every device listens and reconciles immediately. The desktop already
  learned about the phone's edits this way — `writeDoc` woke the renderer
  directly — but the other direction had nothing, so anything done on the laptop
  took up to four seconds to reach your hand, and over a relay it took whatever
  the next poll was.
- Server-sent events rather than a socket: plain HTTP on the connection the app
  already has, no dependency, no upgrade handshake, and `EventSource` reconnects
  on its own — which matters most here, because a phone drops the connection
  every time you switch apps. The relay still stores one opaque document per
  device and still decides nothing; it is told something landed and passes that
  on.
- **The poll stays, as a backstop.** It drops from every 4 seconds to every 30
  while the stream is up, and goes straight back to 4 if the stream drops — so a
  missed reconnect still self-corrects, and a phone doing nothing is no longer
  waking its radio fifteen times a minute.
- **The publish delay is 700ms, down from 1500.** Still long enough that typing a
  title is one write rather than twenty, and now that a write is pushed rather
  than polled for, that delay *is* the gap between the two screens.
- **A phone returning from the background refreshes.** The catch-up pull was
  hung on `focus`, which a suspended phone often never fires — the page was never
  unfocused. It now listens for `visibilitychange` too.
- **The desktop no longer wakes itself.** Publishing went through the same store
  the phone writes to, so every edit made on the desktop told the desktop that
  something had changed — a full reconcile per edit, against a document it had
  just written itself.
- Measured end to end, two devices through a real relay, driven through the real
  UI: **~830ms in both directions**, consistently.

### On the phone

### On the phone

- **The Wi-Fi bridge never synced.** Minting this device's sync identity called
  `crypto.randomUUID()`, which is defined only in a *secure context* — and the
  bridge is `http://192.168.x.x:4785`, which is not one. It threw
  `crypto.randomUUID is not a function`, taking `identity()` and the whole of
  `buildTransport()` with it, so a phone handed the app by the desktop set up no
  sync at all and said nothing about it. The id is now built from
  `getRandomValues`, which carries no such restriction.
- **Typing anything zoomed the app in and left it there.** iOS zooms the page
  when a text field's font is under 16px, and with no `maximum-scale` it does not
  zoom back out afterwards. Every input in the app is 13–14.5px, so editing a
  title, searching, or adding a subtask left the phone zoomed and scrolling
  sideways. Text fields are 16px on touch devices now; the desktop keeps its 14px.
- **Daily reminders were silent on iOS.** An installed iOS web app grants
  notification permission and then refuses the `Notification` constructor —
  `showNotification` on the service worker registration is the only route Safari
  accepts. The constructor threw, and because the tick marks the day as fired
  *before* notifying, the nudge was discarded rather than retried. Reminders now
  go through the worker where there is one, and a failure can no longer escape as
  an unhandled rejection.
- **Every page was slightly taller than the screen.** The page shells were sized
  with `100vh`, which on iOS means the viewport with the toolbar *hidden* — so
  each one carried a phantom scroll and hid its own bottom padding behind the
  toolbar. Same mistake 3.0.0 fixed for the modals and drawers; the pages were
  left behind. They track the visible viewport now.

### The service worker

- **The phone stopped seeing the desktop's changes.** When the app is served by
  the Wi-Fi bridge or a relay, the sync API lives on the same origin — and
  `api/peers` is polled every four seconds on a URL that never varies. The
  worker's cache-first branch treated that like an asset: the first poll's answer
  was returned to every poll after it, so the phone kept syncing, kept seeing the
  same document, and silently never learned anything. `cache: 'no-store'` on the
  call was no defence — that governs the HTTP cache, and a worker sits in front
  of it. The worker now stays out of `/api/` entirely.
- **An error page could become the offline shell.** Navigations were cached
  whatever their status, so one 404 or 502 while online left the installed app
  opening onto that error every time it was launched without a network. Only a
  200 is kept now.
- **The installed shell is fetched past the HTTP cache.** `cache.add` honoured
  it, and index.html carries a short max-age — so a worker installing just after
  a deploy could precache the *previous* build's HTML, naming chunks that build
  no longer has.
- **A loading tab keeps the nav bar.** The route fallback was an empty
  full-height div: on a phone fetching a tab for the first time, a second or two
  of blank page is indistinguishable from the app having died, which is the whole
  complaint 3.0.2 set out to fix. The chrome now stays put while the page
  arrives, and the other tabs stay tappable.
- **Tapping a failed tab again retries it.** The error boundary reset on the path
  changing, so the one gesture everyone tries first did nothing. It now resets on
  any navigation, and clears before the render rather than after, so leaving a
  failed page doesn't paint the error one last time on the way out.
- **`immutable` is for hashed files only.** Both servers pinned everything but
  index.html for a year — including sw.js, the web manifest and the icons, whose
  names never change. A phone holding an old copy of one of those had no way to
  find out.

## 3.0.2 — 2026-08-31

The other tabs open on the phone.

- **Quests, Vynues, Systems and All went blank when tapped.** Every tab but Today
  is fetched over the network the first time it's opened, and on a phone that
  fetch fails — no signal, a dropped request, or an app left on the home screen
  across a deploy asking for a file the new build replaced. A rejected import
  reaches React through `lazy()`, and with nothing to catch it React unmounts the
  whole app: a black screen with no nav bar, recoverable only by killing the app.
  Today kept working because it is the one page that ships in the main bundle,
  which is exactly why it looked like the *tabs* were broken.
- **A failed load now retries**, twice, with a widening pause — most of these are
  one dropped request. If the chunk really is gone, the app reloads itself once
  to pick up the current build's file names, which is the only thing that can fix
  a page left open across a release.
- **And if all that fails, you get a page instead of a void**: the nav bar stays
  on screen with a short explanation and a way back to Today. It comes back on
  its own when the network does.
- **The installed app now downloads every tab at install**, not just the one you
  happened to open. The service worker took a copy of what had been loaded, so an
  offline phone could open Today and nothing else — the offline promise only held
  for the first screen. The build writes the list of its own files and the worker
  precaches all of them.
- **One previous build is kept in the cache** rather than evicted the moment a
  new worker takes over. A phone keeps the app resident for days, so the document
  on screen is often from the build just replaced, and pulling its files out from
  under it is the same blank screen by another route.
- **A missing asset is a 404**, from both the desktop Wi-Fi bridge and the relay.
  Both used to answer any unknown path with the app shell, so a phone asking for
  a rebuilt chunk got HTML at status 200 where a module was expected — a failure
  the app could neither diagnose nor recover from.

## 2.0.0 — 2026-08-14

Systems: the app now models the *process* you run, not only the outcome you're
aiming at. A major bump because it adds a new top-level concept, a new tab, and
a new field on every task.

### Systems

- **New `System` entity** and a **Systems tab**, sitting before Quests in the nav.
  A system is a named set of repeating actions. Its link to a goal (questline) is
  optional by design — a system with no goal attached is the point, not an
  oversight, and one must be able to outlive the goal that prompted it.
- **Side panel** for creating and editing, asking three things: the system's
  name, its actions and how often each runs, and the goal it serves. Actions can
  be typed straight into the panel (they become real tasks) or pulled in from
  tasks you already have.
- **Health score** per system: the mean of its actions' consistency over a
  trailing 30 days, cadence-aware (a "gym 3×/week" action expects ~13 reps a
  month, not 30). Averaged rather than all-or-nothing, so three habits at 70%
  reads as a system that is working. The window clips to each action's age, so
  adding a habit late never scores it against a month it didn't exist for.
- **Trend arrow** — the last 7 days against the 7 before, silent when there
  isn't enough history to mean anything.
- **"Don't miss twice"** — an action missed exactly once is flagged the next day,
  while it's still a nudge rather than a verdict.
- The anchor group (**Fixing my Chud life**) is *not* a system — it is a section
  of the Today tab, pinned beside the day's list. A system is a process aimed at a
  goal and scored on consistency; that group is the few things you want in front
  of you every day. A one-time migration moves it there, keeping the habits, their
  streaks and any other system they belong to. A task marked for it shows there
  and only there.
- Deleting a system keeps its actions (unassigned); deleting a goal detaches the
  systems that served it. A grouping going away must never delete the work.

### On your phone

- **The desktop app serves Milestone to your phone over your Wi-Fi.** Turn it on
  in Data → *On your phone*, open the link it shows, and add it to the home
  screen. No account, no hosting, nothing uploaded anywhere — the phone talks to
  your computer and only while the bridge is on.
- Serving the app from the desktop rather than pointing the phone at the hosted
  copy is what makes it work at all: a page loaded over HTTPS is not allowed to
  talk to a `http://192.168.x.x` address, so a hosted page could never reach it.
- **Same sync, not a second one.** The phone is another peer in the existing
  protocol — per-slot vector clocks, fast-forwards, and a rescue copy on a real
  conflict. It publishes its own document and reads everyone else's, exactly as a
  second computer does through the cloud folder.
- The link carries a key, minted once and kept, so a phone is paired rather than
  anything on the network being able to read your tasks. It's taken out of the
  address bar after the first load.
- Phone-width layout: the nav wraps and its tabs scroll on their own line, the
  page no longer drifts sideways, and the tomorrow flipper moves to the bottom
  corner instead of sitting on the New task button.
- **Modals scroll when they outgrow the window.** The overlay centred its panel
  with no scroll container, so a tall one — the Data modal on a phone is 1157px
  in a 599px window — overflowed off *both* ends with nothing to scroll, putting
  Import permanently out of reach. Centring is now `margin: auto`, which gives
  way to top-aligned-and-scrollable when there isn't room; a flex child taller
  than its container can never be scrolled back above the start edge. Fixed for
  every modal at once, and the last button clears the home bar.
- **The home-screen icon is full bleed.** `logo.svg` insets its tile by 16px and
  rounds the corners, which is right in the UI and wrong on a home screen: iOS
  masks the icon itself and paints any transparency **white**, so it installed
  ringed in white at the edges and corners. The installed icons now render from a
  full-bleed variant of the same artwork with the alpha channel flattened away,
  plus a dedicated 180×180 `apple-touch-icon` at the size iOS actually wants. The
  Android maskable icon keeps its safe-zone inset — that one is meant to be
  cropped.

#### Away from the desktop

- **The phone copy is independent.** The whole profile lives on the phone and the
  service worker serves the app offline, so it opens, edits and saves with no
  signal and no computer. Syncing is when the two copies find out about each
  other, not what makes either of them work.
- **`server/relay.mjs`** — an always-on meeting point for when the two devices
  are never awake at the same time. Run it anywhere (`npm run relay`, with
  `MILESTONE_TOKEN` set); it serves the app *and* holds the documents, so the
  phone installs Milestone from it and syncs to it. No dependencies — `node:http`
  and the standard library.
- It is deliberately dumb, which is the security argument as much as the
  simplicity one: one opaque document per device, handed back on request. It
  never merges and has no idea what a task is, so every decision about whose data
  wins still happens on your devices. It refuses to start without a key.
- **Every route at once.** A device now composes its bridges — cloud folder,
  Wi-Fi, relay — into one. Reads take the union, writes go everywhere, and a
  route being down is not a failure as long as one worked. The reconciler is
  unchanged: it still sees a single bridge.
- Point both devices at the same address and key in Data → *On your phone* →
  *When you're away*. The card checks it while you're looking at it, rather than
  silently never syncing.

### Undo, everywhere

- **Ctrl/⌘-Z steps the whole app back**, and Ctrl+Shift+Z (or Ctrl+Y) forward
  again. Not a list of undoable actions — it restores the state itself, so
  anything that can change your data is undoable, including whatever gets added
  next. A toast says what happened and offers the way back.
- One gesture is one step: a drag that fires a reorder per frame undoes as a
  drag, not as forty of them. Sixty steps are kept.
- Left out on purpose: the 5am rollover, the archive purge and incoming cloud
  sync are not things you did. Adopting another computer's data clears the
  history rather than letting Ctrl+Z reach back across it.
- Inside a text field the keys still mean "undo my typing".

### Nothing here is one-to-one

The relationships between habits, systems and goals are all many-to-many. Every
single-slot field forced a choice the real thing doesn't have, and every one of
them is gone:

- **A habit can be in several systems.** A morning walk is both physical base and
  getting outside; it's listed under each, and leaving one leaves the others.
- **A system can serve several goals.** One process usually feeds more than one
  outcome, and it shows on every questline it serves.
- **Several systems can serve the same goal** — it was never owned by one.
- **An anchor habit can also be filed under a questline and a quest.** Setting a
  questline used to silently un-anchor the task.
- Deleting a system or a goal drops only *that* membership; every other one the
  habit or system has survives.
- Multi-select pickers throughout: the Today row tag is a tick list, and both task
  drawers take a set rather than a single choice. A habit in more than one system
  shows once on Today, filed under the first, tagged `+n`.

Saves written before any of this load untouched — the old single fields are read
through one helper each and retired the first time you edit that item.

### Connections

- Systems actions appear on Today **tagged with their system**, with their own
  filter chip.
- **Pin** on each action in the Systems page puts it on Today (or takes it off),
  carrying its cadence and tag. Daily actions show a fixed pin — they're on Today
  by definition.
- The **row tag on Today is a menu**: click it to tick a task into any of your
  systems, or out of all of them.
- System pickers in both the task create and edit drawers.
- Systems are searchable from the command palette.
- A questline shows the systems driving it, with their health.

### Tasks

- **Sessions** — a weekly "gym 3×" goal now counts *days, not taps*, with a day
  strip under the row. One-per-day holds by construction; an earlier day can be
  backfilled and the credit lands on the day it happened.
- **Checkpoints** — a counter with a sensible number of steps (64 oz in 16s)
  draws a tappable ladder under the row.
- **Streaks are editable** by hand from the task editor. The app can only count
  what it saw; days before a task existed are yours to put back.
- A streak of 1 now displays (it was hidden below 2, which made an edit look
  like it had failed).
- Anchor habits surface on Today every day whatever their cadence.

### Simplified

- **Every explanatory caption is gone** — the drawers no longer narrate what each
  box is for, and `Field` has no `hint` to put one back. Same on the Systems, All
  and Quests pages and the tomorrow-preview banner.
- Goals and Systems are **dropdowns**, not a permanent column of every questline
  and system you own.
- Popovers open upward when they're near the bottom of the window, and the card
  that holds one no longer crops it.
- Habits in no system are clickable: file them, or open the full editor.

### Fixed

- **The same habit entered twice.** Typing a habit you already have into a system
  used to create a second task, and both then collected half a streak each. It
  now joins the existing one to that system instead. The All page grows an
  "Entered twice" panel for the copies you already have — one click folds them
  together, keeping the one with the most history and giving it the union of
  their systems, days and steps, and the better streak. It only ever offers;
  nothing is merged on your behalf.
- Native `<select>` dropdowns were unreadable in dark mode: the translucent
  input background composited against the OS popup's own white surface, leaving
  near-white text on near-white. Options are now painted opaque — measured at
  14.7:1 in dark and 16.4:1 in light, against 4.5:1 for WCAG AA.
- The tray icon was never shipped beside the packaged exe, so it rendered blank.
- Keyboard shortcuts threw when a key event targeted `window`, killing the
  shortcut for the rest of the session.

### Removed

- The per-habit history panel under Today — streaks and system health already
  carry that meaning.

## 1.5.4 — cloud sync, PWA, and a deduplication pass

Tagged `v1.5.4`. Cloud sync between machines, installable PWA via GitHub Pages,
and a pass removing duplicated logic across pages and drawers.

## 1.5.0 — initial release

First public version.
