# Milestone

A goal tracker built around one idea: long-term goals only move when something
lands on today's list. Questlines hold the ambition, Today holds the work, and
the same task shows up in both.

Runs as a Windows desktop app (Electron) and as an installable PWA from the same
source — see [Builds](#builds).

## What's in it

- **Questlines → quests → tasks.** A three-level breakdown, optionally sequential
  so the next quest unlocks only when the previous one is done.
- **Today.** Every due thing in one list, whatever it came from — routines, quest
  tasks, pinned quests, Vynues project tasks — filterable by category and
  reorderable by hand.
- **Recurrence** that goes past "daily/weekly/monthly": custom intervals ("every
  3 weeks") and calendar rules ("first Monday", "last weekday of every 2 months").
- **Counters and checklists.** A task can be "gym 3×/week" or "64 oz of water"
  rather than a checkbox, and any task breaks down into infinitely nestable steps.
- **Streaks, skips and a heatmap.** A skip is a *neutral* day — it protects the
  streak without earning credit, for when a task was genuinely impossible.
- **Vynues.** A lighter project/task board for work that isn't goal-shaped.
- **Sync and backup.** Cross-computer sync through any folder your cloud drive
  already syncs; JSON export/import; optional Notion push/pull.

## Running it

```bash
npm install
npm run dev            # Vite dev server at localhost:5173
npm run electron:dev   # the desktop shell against that dev server
```

`npm run lint` and `npx tsc -b` are the checks.

## Builds

```bash
npm run package        # regenerate icons, build, package to release/
```

The desktop build lands in `release/Milestone-win32-x64/` (gitignored — it's
~290MB of Chromium). The PWA deploys to GitHub Pages automatically on push to
`main`, via `.github/workflows/pages.yml`.

Version lives in `package.json` and nowhere else: `vite.config.ts` reads it into
`__APP_VERSION__`, which surfaces beside the nav-bar brand and in the Data modal —
that's how you tell a fresh build from a stale one. Bump it with
`npm run release:patch|minor|major`, which bumps, rebuilds and repackages in one
step. Don't hand-edit it.

## Where your data lives

Everything is local. In the desktop app that's Chromium local storage under
`%APPDATA%\Milestone`; in the browser it's the tab's local storage. There is no
account and no server — the sync feature just writes a JSON file into a folder
OneDrive/Dropbox/Drive is already carrying, and each device only ever writes its
own file (see `electron/cloudSync.cjs` and `src/lib/cloudSync.ts`).

Back it up from **Sync & Backup → Download backup**. That same JSON restores via
**Load backup**, and is the format the sync layer parks a rescue copy in when two
computers were edited independently.

## Layout

```
electron/     main process — window, Notion IPC, cloud-folder sync + watcher
src/pages/    Today, Quests, All, Questline detail, Vynues
src/components/  row/drawer/modal UI
src/lib/      pure helpers — recurrence rules, subtask trees, sync reconciliation
src/store.ts  quest + routine state (zustand, persisted); the recurrence engine
src/vynuesStore.ts  the Vynues half of the same
```
