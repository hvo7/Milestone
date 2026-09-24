# Milestone Testing

Run `npm run testing` (or double-click `Open Testing.cmd`) to build and open a separate testing window.

The amber TESTING banner identifies this environment. Build output goes to `dist-testing`, not `dist` or `release`. Its Electron profile, cookies, local storage and cache live under `.testing`. The window has no production desktop bridge, updater, cloud/phone sync, or network access. Closing it quits only the testing app.

On first launch, `.testing/seed.json` supplies a copy of quest and project data from a backup. Later launches retain test edits. Production is never imported again automatically. The seed and profile are ignored by Git. Production credentials and UI settings are not copied.

## Batch 003 — approved for v3.3.2

- Keep skipped and completed habits visible below active habits in Fixing my chud life.
- Show skipped controls only the main Today list; the habit panel always shows its skipped tasks.
- The user approved shipping only this habit-panel feature as v3.3.2.

## Batch 002 — approved for v3.3.1 on 2026-09-23

- Remove artwork from individual quests in every quest row and card; keep questline artwork.
- Override the Read 5 Books and Get Fit questline pictures with the matching illustrated book and fitness icons, in both the sidebar and heading.
- The user approved these revisions for production with a patch-only version bump to v3.3.1.

## Batch 001 — approved for v3.3.0 on 2026-09-23

- Separate testing environment and launch shortcut.
- Illustrated icons for questlines, individual quests, and systems. Theme follows the title; each record has stable color variation. Custom uploaded artwork is preserved.
- Earlier unshipped workspace changes are also present for review, including Today filtering and the 2:00 AM reset.

The user explicitly approved shipping this batch. Icons are enabled in the production build for v3.3.0. Future batches still require separate approval.

## Shipping

Collect features here, review them in the testing window, and wait for explicit user approval of the batch. Only then enable approved feature flags in the release build, validate, bump the version and publish. Publishing workflows are manual-only; do not dispatch them before approval. Do not copy test task data into production.
