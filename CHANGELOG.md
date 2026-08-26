# Changelog

Notable changes per release. The version in `package.json` is the single source
of truth — `vite.config.ts` reads it into `__APP_VERSION__`, which is the chip
beside the nav-bar brand and the line in the Data modal. Bump it with
`npm run release:patch|minor|major`, never by hand.

Dates are the date the version was set, not the date it was packaged.

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
