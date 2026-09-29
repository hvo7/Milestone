# Milestone Testing

Run `npm run testing` (or double-click `Open Testing.cmd`) to build and open a separate testing window.

For testing and annotating inside a conversation, run `npm run testing -- --browser` and open `http://127.0.0.1:4174/` in the right-side browser panel. This serves the same testing build, with its TESTING banner, on loopback only. Keep using this address for future batches. Reload after rebuilding. The browser preview has its own local test storage (separate from the Electron test profile and production); it starts with the app's default data and retains browser test edits. It does not import a production profile or credentials. External connections and service workers are blocked by the preview server. Only `dist-testing` files are served, never `.testing` or repository files. Port 4173 is left available for DentalTrack.

The amber TESTING banner identifies this environment. Build output goes to `dist-testing`, not `dist` or `release`. Its Electron profile, cookies, local storage and cache live under `.testing`. The window has no production desktop bridge, updater, cloud/phone sync, or network access. Closing it quits only the testing app.

On first launch, `.testing/seed.json` supplies a copy of quest and project data from a backup. Later launches retain test edits. Production is never imported again automatically. The seed and profile are ignored by Git. Production credentials and UI settings are not copied.

## Batch 007 — approved for v3.3.5

User explicitly approved this reviewed batch for live production and requested npm run package on 2026-09-29. Includes the recurring-date, archive/settings, title editing, animated quest reordering, and toolbar revisions below. Historical pending-review notes below describe the testing stage; this approval supersedes them for Batch 007 only. Testing data and credentials remain isolated.

- Review 6: lift delay reduced to 180 ms. Neighbouring quests now slide up/down during dragging to leave the destination open, using the lifted card's measured height and spacing; reversing or cancelling restores their positions without saving. Moon/sun moved immediately to the right of + (before Reload). Supersedes earlier delay, insertion marker, and toolbar placement below.

- Latest annotations: quick-click quest titles to edit; hold for 350 ms to lift and drag with animated settling and an insertion marker. All visible quests, including the active quest, participate in their saved sequence; archived positions are preserved. Cancelling or scrolling before the hold does not reorder.
- Moon/sun now lives in the main top-right toolbar, immediately before Add new tab, Reload, and Settings (supersedes the Settings-header placement below). Testing only; no version bump or production release.

- Annotation revisions: archived systems are grouped in expandable questline/quest folders, standalone systems remain rows. Theme is an accessible moon/sun button in the Settings header. Questline, quest, system and shared task titles open their editor; visible pencil/archive row controls are removed, with box-icon Archive actions in edit panels. Questline editing now uses a right-side panel.

- Settings redesigned into General, Archive (box icon), and Data & connections tabs. Archived items and Restore now live only in Settings → Archive, removed from the Systems and Quests pages. No production release approved.

When the browser server is already running, use `npm run testing -- --build-only` to rebuild, then reload the side panel without starting a second server.

- Review revisions: Once and Repeat share a fixed-position due-date field; repeating dates remain schedule-calculated with Next due beneath. Optional system links come after scheduling so they do not push the due-date field down.
- Archive systems, quests, and questlines without deleting content or links. Restore them from Settings → Archive. Archived parents leave Today and reminders; shared habits remain active if another linked system is active. Uses existing persisted hidden flags, so previously hidden items are also available in Archive.

- Repeating General tasks show Current due and Next due in their creation forms and on task rows in Today, Quests, and All.
- Dates follow the existing repeat engine and local 2 AM day boundary; completed cycles and unscheduled calendar-rule days show Current due: None. Missing schedule anchors do not invent dates.
- Display-only: no deadline, reset, pin, or production-profile changes. Not approved for production.

## Batch 006 — approved same-version hotfix (3.3.4)

- Unfinished due-date items remain on Today after the local 2 AM rollover, with an Overdue label and their original deadline intact.
- Pin indicators and removal controls follow the same carry-over rule. Completed deadlines do not stay indefinitely; future deadlines remain off Today unless explicitly pinned.
- User approved live shipping without a version bump: deploy the website and patch the local executable; no new numbered desktop release.

## Batch 005 — approved for v3.3.4

- Explicit pins show General tasks, quests, and project tasks on Today without rewriting their deadlines. Unpinned future/overdue tasks remain off Today.
- Due-today tasks auto-pin; creating a dated General task no longer toggles that automatic pin off.
- Recover due-today items accidentally hidden by older creation code. Deliberate unpins are date-stamped so they suppress that day, not a later deadline.
- User explicitly approved shipping these pin fixes after isolated testing. Production data is not copied from Testing.

## Batch 004 — approved for v3.3.3

- New quests and task drawers default to no due date; new quests default to checklist completion. Existing manual completion semantics are preserved with the same circular checkbox.
- Shared visible pin controls on system tasks, quest cards, the task library, and project tasks. Explicit unpinning suppresses dated quests and daily/project tasks from Today.
- Only Add new tab, Reload, and Settings in the top toolbar; notifications, appearance, data/sync, and Notion live under Settings.
- Notion exports correct standalone/manual quest status, readable schedule/date/category/counter columns, and preserves notes outside its owned snapshot. Imports validate status fields and use normal completion rules. Failed writes no longer create duplicate pages; failed reads do not apply a partial import.
- User explicitly approved shipping this batch directly after isolated testing and packaging, with a patch version bump. No live Notion transfer is performed during validation.

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
