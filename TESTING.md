# Milestone Testing

Run `npm run testing` (or double-click `Open Testing.cmd`) to build and open a separate testing window.

For testing and annotating inside a conversation, run `npm run testing -- --browser` and open `http://127.0.0.1:4174/` in the right-side browser panel. This serves the same testing build, with its TESTING banner, on loopback only. Keep using this address for future batches. Reload after rebuilding. The browser preview has its own local test storage (separate from the Electron test profile and production); it starts with the app's default data and retains browser test edits. It does not import a production profile or credentials. External connections and service workers are blocked by the preview server. Only `dist-testing` files are served, never `.testing` or repository files. Port 4173 is left available for DentalTrack.

The amber TESTING banner identifies this environment. Build output goes to `dist-testing`, not `dist` or `release`. Its Electron profile, cookies, local storage and cache live under `.testing`. The window has no production desktop bridge, updater, cloud/phone sync, or network access. Closing it quits only the testing app.

Each launch through `Open Testing.cmd` or `npm run testing` reads the newest valid automatic backup from `%APPDATA%/Milestone/backups` into `.testing/seed.json`. The desktop testing window adopts changed snapshots before loading its stores. When the source has not changed, testing edits remain. Before adopting a changed source, the previous test quest/project data is retained in the localStorage key `milestone-testing-before-refresh`. Life Vitals data is preserved separately. Close the testing window and reopen it to refresh from production; this is a backup snapshot, not live sync. Open production and let its backup finish first if you need the latest edits. If no valid backup is available, the launcher warns and keeps the previous copy. Browser preview storage remains independent and does not import this snapshot. The seed and profile are ignored by Git. Production credentials and UI settings are not copied.

## Batch 015 - approved for v3.3.12

User approved production on 2026-11-10, including Show last check-in. Production now uses the status check-in page. Fresh profiles start empty; existing area names and definitions migrate from production-only storage, and previous storage remains untouched. The notes below describe the preceding testing work.

v3.3.12 production build, targeted lint and all 14 status check-in tests passed. Packaged and verified `release/Milestone-3.3.12-win32-x64/Milestone.exe`, including the last-check-in control and exclusion of testing profile/seed files. After the user closed Milestone, the original `release/Milestone-win32-x64` folder was updated successfully. Executable version is 3.3.12 and app.asar SHA-256 matches the verified package. No user data was changed. No hosted deployment or GitHub release was performed.

- Added Show / Hide last check-in in each area's popup. The optional panel shows the latest saved status, date, reason and next step; new unsaved selections do not change it. Areas with no saved entry show No check-ins yet. Editing older history does not change which check-in is shown.

- Replaces the testing checklist with a direct Behind / On pace / Ahead choice, optional reason and optional next step. The reason label adapts to the selected status. New check-ins require a deliberate status choice; there is no automatic score.
- Area setup contains just name and optional personal On pace definition. Users can rename, revise their definition, archive and restore areas. No filler subtitles or explanations.
- Each save adds a dated history entry. History is collapsed by default, displays five entries at a time, and supports editing older entries while preserving their original dates. Edits to old entries do not replace the newest status. Each entry retains the personal definition that applied at the time.
- Overview retains the red/amber/green gradients and now shows the last check-in timestamp. Detail retains the expanding popup and gray backdrop with reduced-motion support.
- Uses separate status-vitals storage. Existing checklist areas retain names, archive state, checklist wording as their On pace definition, and any dated last status as one history entry. Older numeric areas retain names and definitions but do not acquire fabricated historical dates. Previous stores are never overwritten. Fresh production starts empty; testing examples never load into production.
- Validation: 12 domain/UI tests cover status choice, reasons, history, older-entry editing, storage reload, migration and production isolation, customization, cancel and failed saves. Hidden Electron visual capture was unavailable; desktop/mobile appearance still needs on-screen review. Production remains v3.3.11.

## Batch 014 - Simple Life Vitals - superseded in testing by Batch 015

- Testing uses a new checklist system. Setup requires only an area name and one keeping-up check; optionally add up to three checks total. No units, targets, periods, tolerances, factor modes, notes or icon menu.
- Check-in shows one to three custom boxes plus Made extra progress. Any unchecked basic means Behind; all checked means On pace; all checked plus extra means Ahead. Extra is disabled until all basics are checked and clears when a basic is unchecked. Save check-in commits the result; closing cancels changes. Untouched areas show Not assessed.
- Existing area names and archive state carry into the new setup with one unassessed baseline. Old numeric definitions remain untouched in their old storage keys. Simple checks use a separate key and production remains on v3.3.11 until this batch is approved. Fresh production storage stays empty when this feature is released.
- Editing checklist definitions clears the prior check-in so an old completion cannot claim a newly defined item is done. Saved empty lists stay empty; unreadable new data is reported and cannot be overwritten by adding an area.
- Status gradients, expanding popup, gray backdrop and reduced-motion support remain. No filler descriptions were added.
- Validation: 11 domain and rendered UI tests passed, covering status rules, no test data in production, legacy preservation, check limits, actual checkbox interaction, extra gating, cancel and save failure. Testing build and targeted lint passed. Browser preview serves on port 4174; opening the conversation panel was unavailable.

## Batch 013 - approved for v3.3.11

User approved production on 2026-11-09. Life Vitals route/navigation and interface motion are enabled in production. Production starts empty using its own storage key; examples and testing snapshots are not imported. Generic page subtitles and Life Vitals filler copy are removed. The entries below describe the preceding testing work.

Production v3.3.11 packaged successfully at `release/Milestone-3.3.11-win32-x64/Milestone.exe`. The standard output folder was locked (EPERM replacing d3dcompiler_47.dll), so packaging used the new `--versioned` option. Nine Life Vitals tests, production build, targeted lint and archive verification passed. Existing installed shortcuts, hosted web deployment and GitHub release were not updated.

Retry succeeded: copied the verified v3.3.11 package into the original `release/Milestone-win32-x64` folder. Executable version is 3.3.11 and app.asar SHA-256 matches the verified versioned package. Production user data was not modified.

- Testing motion polish: brief page entrances, active-tab underline reveal, toolbar/editor button press feedback, smooth sidebar selection colors, Life Vitals editor entrance and expandable detail fades. Existing task completion, progress, drawer and focus-popup animations remain in charge. All additions are scoped to testing and disabled with reduced motion; no continuous animations or page transforms.

- Vital blocks now use status-tinted gradients: green Ahead, amber On pace, red Behind, neutral Not assessed. Badges and left-edge accents match in light and dark themes; status labels remain visible. Hover preserves the gradient.

- Selected Life Lanes layout: full-width rows, platform palette, and an expanding detail popup over a gray backdrop. Keyboard focus is contained in native dialogs; Escape, backdrop and close button return to the row. Reduced-motion preferences skip zooming.
- Empty testing profiles now start with editable fictional Gym, School, Work, Finances, Wellbeing and Relationships examples. Existing saved custom/archived areas are preserved. Create and rename any area, select an icon, archive/restore areas, and add/remove up to 30 custom factors per area.
- Testing reload button spins once per click (repeated clicks restart it); reduced-motion settings use a brief opacity change. Existing refresh behavior is retained.
- This revision passed the testing build, targeted lint and 9 Life Vitals tests, including production/test storage isolation and preserving saved custom areas. Reload animation still needs on-screen review.
- Factors support higher-is-better progress, lower-is-better limits, and subjective assessments with written criteria. Numeric factors have actual value, expected amount at check-in, whole-period goal/limit, custom units and an inclusive on-pace tolerance. Blank actual means Not assessed, not zero.
- Choose which factors affect the area status. Any included Behind factor means Behind; all included factors must be Ahead for Ahead. Otherwise On pace, or Not assessed when an assessment is missing. Excluded factors remain visible.
- Tracking period is user-defined. Assessments are snapshots updated manually: no automatic rollover, calendar pacing, history, task integration, or sync. The interface states these limits.
- Preview data uses milestone-testing-life-vitals-v2. Previously saved v1 mock data is converted on read without overwriting the old key. Future production uses its own milestone-life-vitals-v1 key, starts empty, and never imports testing data or example seeds. Route and navigation remain testing-only. No production release performed.
- Validation: all 5 focused tests passed, covering progress/limit comparisons, decimal tolerance boundaries, manual/missing values, aggregation, validation and legacy conversion. TypeScript/testing build, targeted ESLint and diff whitespace checks passed. On-screen animation verification remains outstanding because earlier local browser and Electron preview attempts were unavailable.

## Batch 012 - approved and released as v3.3.10

User approved production release on 2026-10-19. `npm run package` completed; desktop output is `release/Milestone-win32-x64/Milestone.exe`. Cloudflare app/relay deployment completed as `da1013bb-755a-46d3-a50f-cdb034a11d43`. No GitHub release was published, production profiles were not changed, and Testing data/credentials were not transferred. Other desktop installations must update before they receive these safeguards.

Validation: 474 application tests, 50 focused sync tests and 9 Node desktop/watcher/HTTP tests passed, along with actual local Cloudflare runtime integration. Three isolated production renderers synced phone edits in 767 ms and desktop edits in 776 ms without reloads. Final builds and targeted sync lint passed. Existing repository-wide lint and dependency findings are recorded in `docs/engineering-review-2026-10-19.md`.

- Fixed a first-pairing race found by the real-renderer smoke test: initial bookkeeping no longer publishes an empty baseline before adopting the existing peer; backup-before-adoption remains intact.

- Fix the idle upload loop: exclude own files and non-peer files from the OneDrive watcher; remember successfully delivered snapshots for each connection so an offline laptop does not cause unchanged uploads. A new connection publishes once; failed writes remain pending and new edits/adopted clocks publish normally.
- Push still delivers changes immediately. Healthy polling and the reconciliation backstop now run every five minutes; disconnected polling and capability discovery retry once per minute. Notification-triggered reconciliation reuses its fetched peer list.
- HTTP requests and WebSocket handshakes share a persisted per-origin, per-device-profile budget: 30 per minute and 8,000 per UTC day. Budget exhaustion pauses network calls while retaining local edits for retry. HTTP preflight requests, older clients, other profiles/devices, and third-party traffic are outside this client budget, so it is not an account-wide Cloudflare quota guarantee.
- Regression coverage simulates an offline peer for 24 hours with zero unchanged uploads, verifies a fresh edit still uploads, and verifies minute/day budgets and UTC reset.

## Batch 011 — approved for v3.3.9

Local desktop packaging completed successfully with `npm run package` after the user closed the running app. Output: `release/Milestone-win32-x64/Milestone.exe`. No GitHub release was published by this local packaging step; no device pairing or profile transfer was performed.

The user explicitly approved the desktop release, including sync improvements and per-questline Manual/Automatic sorting. Validation: 469 application tests, 42 focused sync tests, and 8 desktop/HTTP integration tests passed. Version advanced to 3.3.9 using the patch-version script. No device pairing, profile overwrite, or Testing data transfer is authorized by this packaging step. Historical pending-review notes below describe the testing stage.

The user added the Cloudflare secret separately; live verification confirmed `configured: true` and unauthenticated peers still return 401. The secret was not read or copied into this repository.

- Cloudflare hosting exception approved by the user on 2026-10-18 and deployed: `https://milestone-sync.henryhuyvo74.workers.dev`, version `6c547b0c-707b-4ad9-9b75-9b2e0598bcfc`. Only code-only web assets and the relay were uploaded; no device data, Testing profile, credentials, or desktop release. Live checks: app 200, health 200 with `configured: false`, unauthenticated peers 401. The pairing secret still needs to be set before desktop-first pairing. No paid services or plan upgrades were requested. This approval does not approve packaging or releasing the desktop batch. Earlier no-deployment notes below describe the preparation stage.
- Cloudflare adapter prepared locally: SQLite Durable Object storage, authenticated HTTP exchange, chunked large snapshots, hibernating WebSocket push, and code-only static app assets. Node/Wi-Fi relay SSE remains supported. No Cloudflare deployment, pairing keys, or device resets performed. User completed Wrangler browser authorization; OAuth credentials remain managed by Wrangler, not in the repository or Testing profile.
- Read-only Cloudflare check confirmed `milestone-sync` does not yet exist on the authorized account. Deployment still awaits batch approval. Same-origin iPhone pairing uses the saved connection key; offline push discovery retries instead of permanently falling back to an unsupported transport. Latest focused sync checks: 42 application tests plus 8 desktop/HTTP tests, and 3 push-transport tests. Testing build passed again after these changes.
- `npm run test:cloudflare` exercises the actual local Cloudflare runtime with synthetic data: two-way push, authorization, invalid/stale writes, large payloads, backup retention/retrieval, and restart persistence. Setup and desktop-authoritative iPhone pairing are documented in `docs/relay-cloudflare.md`.
- Cloudflare developer tooling lives in its own locked dependency tree; uses the same Miniflare runtime as Wrangler. Audit reports zero vulnerabilities there. Free-plan quotas still apply; the adapter caps device/snapshot counts and retains 20 recovery backups. The new app tests total 467 passing; local deployment dry-run passes.

- Device sync reliability revamp: Wi-Fi sharing and remote relay no longer depend on folder sync being enabled. Saving a validated relay or toggling phone sharing reconnects immediately. Paired mobile PWAs retain their route when launched offline.
- Durable pending uploads retry after reconnect/startup and every 15 seconds, even when peers have not changed. SSE remains the live path, with a 4-second fallback poll. Requests time out; duplicate watchers are cleaned up; partial-route delivery remains pending instead of falsely reporting success.
- Initial desktop publication now advances its clock so fresh phones can adopt it. Incoming records are validated before application. Concurrent whole-store edits use stable per-slot edit timestamps and deterministic tie-breaking; both snapshots are backed up before resolution, and backup failure prevents replacement. This is not item-level merging: concurrent edits within the same store still select one version and retain the other in recovery backups.
- Settings reports the last successful exchange and pending errors; folder inspection no longer changes the active connection before confirmation. The preview explains sync isolation and never connects to production.
- Validation uses synthetic desktop/mobile profiles and an ephemeral local relay (no live credentials or production data). Real-device pairing and remote hosting still need confirmation; the website alone is not a sync server. Production release is not approved.
- Checks: 465 application tests passed; `npm run test:sync` passes 41 focused tests plus 8 desktop/real-HTTP relay tests. Testing build and targeted lint passed. Preview continues on port 4174. Safari home-screen installation was confirmed by the user; its source address and pairing remain unverified.

- Sorting now belongs to each questline's edit panel: Manual / Automatic. Automatic defaults on and sorts oldest-created first within unchecked/checked groups in both views; Manual restores saved order and dragging. The global General-settings toggle is removed. New quests and steps receive creation timestamps; older undated items use their known saved sequence, captured before manual reordering. Historical creation times cannot be recovered for legacy items.

- Fix unchecked-first sorting being bypassed in Edit mode. Both questline views now honor the same toggle. While automatic grouping is on, Edit-mode drag handles are hidden and drag writes are blocked; disabling it restores saved manual order and dragging. Production unchanged.

## Batch 010 — approved for v3.3.8

User explicitly approved this feature for production on 2026-10-18. Testing data and preferences are not copied into production.

- Settings → General: Unchecked items first, enabled by default. Completed quests move below unfinished quests; checked tasks within a quest move below unchecked tasks. Stable display-only grouping preserves manual order and sequential unlocking.
- Disable the toggle to restore manual order and normal hold-to-reorder. Edit mode always shows manual quest order. Preference is stored per device/profile; production is unchanged.

## Batch 009 — approved for v3.3.7

User explicitly approved this reset-time feature for production on 2026-10-14. Testing data and preferences are not transferred to production.

- Settings → General has a Goal reset time picker and explicit Save button, defaulting to 02:00. Stored per device/profile in UI preferences; no production profile changes.
- Local logical-day boundaries, weekly boundaries, Today previews, repeating-date calculations and the automatic day clock follow the selected hour and minute. Saving refreshes immediately and re-arms the clock; the setting can therefore begin a new logical day immediately.

## Batch 008 — approved for v3.3.6

User approved publishing this repeat-date fix to production on 2026-09-30. No testing data is transferred; existing task schedules are not migrated.

- New-task interval repeats allow editing Current due date. The chosen date anchors the saved repeat cycle and recalculates Next due, rather than being discarded as a one-off deadline. Applies to General, quest-linked, and project tasks in the New task drawer. Calendar-rule dates remain controlled by their rule. Existing tasks and production are unchanged.

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


## Testing batch: Today quest pins (2026-11-11)

Status: approved for production by the user on 2026-11-11, including an explicit retry after the interrupted promotion. Version 3.3.13 is installed in the local production app folder. Source branch: testing/today-pins; approved source and release documentation are promoted to main. The initial testing-only observations below are historical.

Request and behavior: completed pinned quests stay on Today through their completion day, then lose their manual pin at the configured local day-reset boundary. Unfinished pins remain. Today shows an always-visible pin control on existing quest rows, including Done for today; it unpins without deleting, completing, or changing deadlines. The tomorrow preview is read-only. Due-date scheduling can still surface a quest on a later due day.

Implementation: src/domain/taskState.ts derives expiry from the manual completion stamp or latest visible checklist step and clears trackedToday before recurrence resets erase evidence. src/lib/today.ts uses the same expiry for previews and due summaries. src/pages/Today.tsx wires unpin for quest rows only; src/components/today/TaskRow.tsx reuses PinButton in both layouts and suppresses the redundant delete-shaped unpin control. src/lib/todayQuestPinExpiry.test.ts covers empty/manual/checklist quests, rollover, unfinished pins, recurrence resets, and rendered open/completed unpin actions.

Storage and compatibility: no schema change; only the existing trackedToday flag is cleared. Completion history, steps, deadlines, and quests are retained. Legacy completed quests lacking any valid completion timestamp expire on the first processing pass. Existing routine/project scheduling is unchanged. Testing data remains isolated; no profiles, snapshots, credentials, or generated output are included in the commit.

Validation (initial testing stage): npm test -- src/lib/todayQuestPinExpiry.test.ts src/lib/todayPinRegression.test.ts src/lib/today.test.ts src/store.test.ts passed: 4 files, 99 tests. npm run testing -- --browser passed TypeScript and the testing Vite build, serving http://127.0.0.1:4174/. Browser visual verification was blocked: conversation browser returned "Tab 1 is not part of browser session". Automated rendered click tests passed; no manual visual pass is claimed. The full suite was subsequently run for production as recorded below.

Review: open the testing URL, pin a quest from Quests, return to Today, click its pin in either open or completed state. Verify the quest remains in Quests. Complete another pin and check Tomorrow or cross the configured reset time. For rollback, close Milestone and launch the retained release/Milestone-3.3.12-win32-x64/Milestone.exe, or restore that version's application files to the production app folder. Do not restore or copy testing profiles. Cleared pins can be manually restored in Quests; rolling back code does not reverse pin changes already saved.

Publication: remote main and its three release/deployment workflows inspected; all deploy only by workflow_dispatch. Source is published through the GitHub connector with an expected-head check because shell Git networking failed and this checkout's Git metadata is read-only. Local HEAD remains c218de8; GitHub main is authoritative after promotion. Existing unrelated working changes were preserved. Testing source commit: 94b0dddea8d2700b034cdf6840ab1fa5550776e1, directly descended from main ffd5b431e057048fc307091a12f44ded2f3de71c.

Production retry verification (2026-11-11): npm test -- --reporter=dot passed 49 files / 515 tests. Existing React act-environment warnings did not fail tests. The prior promotion session reported successful npm run build and targeted ESLint checks; those commands were not repeated during the retry because no application code changed. SHA-256 comparison confirmed that release/Milestone-win32-x64/resources/app.asar exactly matches release/Milestone-3.3.13-win32-x64/resources/app.asar. All 76 packaged renderer/Electron files matched their current local runtime inputs; embedded package metadata and executable FileVersion/ProductVersion are 3.3.13. Source under src, electron, and scripts matches the approved GitHub testing tree after line-ending normalization. No manual visual pass or new production launch is claimed.

Access and boundaries: open the existing Milestone shortcut or release/Milestone-win32-x64/Milestone.exe. Restart an older running instance to load 3.3.13. Production profiles, Life Vitals, connection credentials, and .testing data were not copied or modified by this release operation. Changes affect the existing trackedToday flag during normal runtime; no schema migration is required. Only package.json, package-lock.json, CHANGELOG.md, and this release record are added to the approved testing tree for promotion.

Distribution limitation: this operation updates the local Windows production package and versions source on GitHub. Hosted deployment and downloadable GitHub Release were not dispatched. The shell Git credential helper failed with Windows access errors while checking workflow status; the connected GitHub tools support source publication but expose no workflow-dispatch action. No hosted deployment or downloadable release success is claimed. The retained 3.3.12 package remains available for local rollback.

## Testing batch: Life Vitals action checklists (2026-11-11)

Status: testing only on testing/life-vitals-checklists. Production approval is pending for this batch. The earlier Today-pin approval does not apply. No version bump, installed app patch, production build, deployment, or release dispatch was performed.

Request and scope (revised): add practical two-tier action plans for falling behind and maintenance checklists for staying on pace. Every life area retains independent Catch-up and Maintenance lists. Neither is shown on overview cards or when first opening an area. Selecting Behind in the check-in form reveals Catch-up; selecting On pace reveals Maintenance. Ahead shows neither. Saved lists remain intact across selection changes; unsaved item editor drafts are cancelled when switching status. The prior tab-based, automatically visible presentation is superseded by this revision.

Behavior: add, rename, delete, and reorder tasks and their immediate subtasks. Tasks with subtasks derive completion from all their subtasks; leaf tasks use their own checkbox. Any order is the default. Sequential mode gates unfinished tasks behind preceding incomplete tasks and gates unfinished subtasks within their parent. Existing completed items remain completed when the order changes or an earlier item is reopened; they may always be unchecked. A parent's checkbox is read-only when it has subtasks. Adding a subtask reopens its parent. Deleting the final subtask retains the parent's prior effective completion state. Deleting a task also deletes its subtasks and requires an inline confirmation. Maintenance Reset checks confirms before unchecking the entire list, including partially completed subtasks, and keeps titles and order. Reset is manual, not scheduled. Checklist completion prompts a status review but never creates a check-in or changes Behind / On pace / Ahead automatically.

Persistence and compatibility: optional plans.catchUp and plans.maintenance fields extend each StatusVital under the existing status-vitals-v1 key; older entries without plans remain valid and empty until the user adds tasks. Existing check-ins, personal On pace definitions, reasons, next steps, and archives are preserved. Checklist actions save immediately; text drafts use Save item / Cancel. Failed writes leave saved state unchanged and preserve the editor for retry. An in-progress check-in draft survives checklist saves. Validation accepts at most 100 tasks per list and 50 subtasks per task with 200-character titles, unique IDs within each list, and no third tier. Production and testing storage keys/origins remain separate. No testing data is transferred. Life Vitals storage remains local to its existing device/browser profile; this batch does not add cross-device sync or create linked Today quests.

Implementation: src/lib/vitalPlans.ts defines data validation, ordering, completion and reset behavior; src/components/VitalChecklist.tsx owns list controls and inline confirmation/editor state; src/lib/statusVitals.ts accepts optional plans; src/pages/StatusLifeVitalsPage.tsx embeds checklists outside the check-in form; src/pages/statusVitals.css supplies responsive wrapping, indentation, focus states, and existing theme colors. src/lib/vitalPlans.test.ts and src/pages/StatusLifeVitalsPage.test.tsx cover dependency rules, reset, legacy compatibility, invalid data, chosen-status preservation, reload, actual UI creation, save failure and confirmed deletion.

Validation: npm test -- src/lib/vitalPlans.test.ts src/lib/statusVitals.test.ts src/pages/StatusLifeVitalsPage.test.tsx passed 3 files / 20 tests. npx eslint src/components/VitalChecklist.tsx src/lib/vitalPlans.ts src/lib/vitalPlans.test.ts src/lib/statusVitals.ts src/pages/StatusLifeVitalsPage.tsx src/pages/StatusLifeVitalsPage.test.tsx passed. npm run testing -- --browser initially caught a TypeScript narrowing error in validation; corrected it, then reran successfully: TypeScript passed and Vite built dist-testing, serving http://127.0.0.1:4174/. Full repository tests were not rerun for this isolated feature. Browser visual inspection was attempted, but the conversation browser returned "Tab 1 is not part of browser session"; no visual pass is claimed.

Manual review pending: open the testing origin, choose Life Vitals, open an area, add a Catch-up task with two subtasks and another task; select Sequential and verify unlocking. Switch to Maintenance, add/check tasks, reset checks, reload, and confirm both lists remain. Rename/reorder tasks and subtasks, test delete confirmation, then save an On pace check-in and confirm the Catch-up plan is retained. Review narrow-window and keyboard usability. Existing saved testing areas are not reset or overwritten with examples. The preview process reported successful startup; a separate Node HTTP probe was blocked by connect EACCES to 127.0.0.1:4174, so external reachability is not verified.

Publication and recovery: remote main 7e9a0b5f2c18b4c9b5db6067a236021eac7daf80 is the source baseline. Publish only the eight batch source/test/documentation files onto testing/life-vitals-checklists through the GitHub connector, verifying the remote head. Existing deployment workflows remain manual-only. Local Git metadata is read-only and remains at the older local HEAD; unrelated checkout changes are preserved. To roll back testing, restore these files from the baseline and rebuild using npm run testing -- --build-only; leave localStorage intact so the optional plans remain recoverable when this feature is restored. Remaining work: user visual review and explicit production approval.


### Revision: status-gated plans, Needs attention, and current priority (2026-11-11)

This revision supersedes the initial checklist visibility and manual-review instructions above. Opening a life area shows no checklist, regardless of its saved status. Choosing Behind reveals only Catch-up; choosing On pace reveals only Maintenance; choosing Ahead hides both. Checklist tabs are removed. The matching list is below the check-in form, avoiding nested forms. Saved list contents survive toggles/reloads; unsaved item-editor drafts are discarded on status switches. Saving checklist actions still does not save or change the chosen status until Save check-in is used. Editing an existing check-in selects its status and reveals the corresponding list.

Needs attention is a filter alongside All areas. It contains non-archived Behind areas, areas without check-ins, and areas whose newest check-in creation date is at least seven elapsed days old. Labels distinguish Behind, Not checked yet, and Review due (7+ days). Review age does not change the user's status. The seven-day threshold is fixed for this batch. Attention refreshes every minute and on window focus; editing an old check-in does not reset its creation date. The filter has counts and an empty state.

Current priority is an optional single selection across active life areas. Choosing a different area replaces the prior selection atomically in the same localStorage write. The selected area sorts first when it belongs to the current filter and receives a Current priority badge; the selector always displays the choice, even when the selected area is excluded by Needs attention. None clears the choice. Archiving clears an area's priority; restoring does not automatically reinstate it. Optional priority booleans preserve old records. Validation rejects multiple priorities and archived priorities. Local save failure leaves the old priority selected.

Affected files: src/components/VitalChecklist.tsx, src/lib/statusVitals.ts, src/lib/statusVitals.test.ts, src/pages/StatusLifeVitalsPage.tsx, src/pages/StatusLifeVitalsPage.test.tsx, src/pages/statusVitals.css, and TESTING.md. No changes to storage keys, sync, production data, or version. Parent branch commit is 0522d851b8666de8a089d9819d305c423a2f368f; this follow-up stays on testing/life-vitals-checklists. Git metadata remains read-only and behind the remote.

Current validation: npm test -- src/lib/vitalPlans.test.ts src/lib/statusVitals.test.ts src/pages/StatusLifeVitalsPage.test.tsx passed 3 files / 23 tests. npx eslint src/components/VitalChecklist.tsx src/lib/statusVitals.ts src/lib/statusVitals.test.ts src/pages/StatusLifeVitalsPage.tsx src/pages/StatusLifeVitalsPage.test.tsx completed without errors. npm run testing -- --build-only passed TypeScript and the Vite testing build. New tests cover the exact seven-day boundary, fresh/archived/never-checked cases, single-priority validation/replacement/clear, priority save failures and reload, filter behavior, and status-dependent list visibility while retaining saved plans. Full suite not rerun. Conversation browser opening http://127.0.0.1:4174/ failed with ERR_CONNECTION_TIMED_OUT; no visual pass is claimed.

Manual review pending: open testing, use Needs attention and Current priority; verify priority replacement and persistence. Open a card and confirm no checklist is shown. Select Behind, add Catch-up items, select On pace and add Maintenance items, then choose Behind again to see saved Catch-up items. Ahead must show neither list. Check narrow layout and keyboard operation. Production approval is still pending for the entire Life Vitals checklist batch. Rollback this revision by restoring the seven files from parent commit 0522d85 and rebuilding testing; retain localStorage, since optional priority fields are ignored by the preceding version and saved plans remain compatible. No deployment workflow is dispatched.

### Revision: put status first in the area card (2026-11-11)

User screenshot showed the original automatically visible Catch-up/Maintenance tabs. The current source already removed those tabs; this revision also moves the status selector directly after the area title and puts the matching checklist immediately below it. The saved-status badge above the title is removed to avoid suggesting that a new check-in already has a selection. Last saved status remains available through Show last check-in and on the overview. A new check-in starts with no radio selected and no checklist; Behind reveals Catch-up, On pace reveals Maintenance, and Ahead shows neither. No new Catch-up/Maintenance toggle buttons are introduced. This supersedes the preceding revision's placement of the checklist below the form.

Implementation: src/pages/StatusLifeVitalsPage.tsx places radio controls outside the check-in form and associates them through form="vital-check-in-form". Checklist item forms remain separate, with no nested forms. History edit focus targets the top selector through the dialog. src/pages/StatusLifeVitalsPage.test.tsx adds a regression for exact title/selector/checklist order, initial unselected state despite an existing saved status, and each selection's visibility. Saved plans, priority, Needs attention, check-in history, storage keys, and production data are unchanged.

Validation: the targeted command npm test -- src/pages/StatusLifeVitalsPage.test.tsx src/lib/statusVitals.test.ts src/lib/vitalPlans.test.ts passed 3 files / 24 tests. Targeted ESLint completed without errors. A first combined validation/launch command was interrupted after reaching testing startup; npm run testing was restarted after direct local ESLint. Final launch/build evidence is recorded below. Full repository suite not rerun. Source publication continues on testing/life-vitals-checklists from 9483125e837a04924b998f857da30714512ad40c. Production approval remains pending; no installed production package is changed. Local Git metadata remains behind the remote.

Review: use the refreshed Milestone Testing window, open Life Vitals and a life area. Status choices must immediately follow the title with none selected. Choose Behind/On pace/Ahead to verify the corresponding checklist/no checklist. The earlier screenshot is not evidence of the current bundle. Rollback this layout revision by restoring its two source/test files from 9483125 and rebuilding testing; leave saved data intact.

Final validation for status-first revision: TypeScript and Vite passed through npm run testing; the command reported Opening Milestone Testing. Native window inventory did not show a Milestone Testing window afterward, so a refreshed visible UI is not confirmed. No production window was refreshed or altered. The build is ready; manual review must use a freshly opened/reloaded testing instance, not an older loaded card. Automated rendered tests confirm the intended ordering and conditional visibility. Existing deployment workflows remain unchanged and manual-only; only this revision's two source/test files and TESTING.md are published.

### Revision: separate Needs attention side panel (2026-11-11)

Request: move Needs attention into a separate box/view on the side. Replaced the All areas / Needs attention filter buttons with a persistent right-hand aside next to the complete life-area list. The aside shows the count, each area's name, its attention reason, and a Current priority badge where applicable. Each row opens that area's existing status-first dialog; opening it still selects no new status and reveals no checklist. The main list always retains every active area. Current priority stays above the list and sorts matching entries first in both lists. An empty attention list shows No areas need attention; fresh empty Life Vitals keeps the existing create-area flow without a sidebar.

Layout: 260px side panel with a bordered surface and sticky positioning on wide screens; below a 1000px viewport it becomes a full-width box beneath the list, with no sticky positioning. Long area names wrap. Buttons have keyboard focus outlines and descriptive Review area labels. Attention criteria, automatic age refresh, priority persistence, archive behavior and local storage are unchanged. No data migration or production changes.

Files: src/pages/StatusLifeVitalsPage.tsx, src/pages/statusVitals.css, src/pages/StatusLifeVitalsPage.test.tsx and TESTING.md. This supersedes all earlier descriptions of Needs attention as a selectable filter. Earlier status-first/checklist rules remain in effect.

Validation: npm test -- src/pages/StatusLifeVitalsPage.test.tsx passed 1 file / 11 tests. Updated the attention/priority regression to verify all areas remain visible alongside only qualifying sidebar items, sidebar click opens the correct area, no checklist is initially shown, and priority survives reload/failed writes. node node_modules/eslint/bin/eslint.js src/pages/StatusLifeVitalsPage.tsx src/pages/StatusLifeVitalsPage.test.tsx passed. npm run testing -- --build-only passed TypeScript and Vite. Full suite not rerun for this layout change. Conversation browser opening the stable http://127.0.0.1:4174/ preview returned ERR_CONNECTION_TIMED_OUT; desktop/mobile visual verification remains pending and is not claimed.

Manual review: reload/reopen the testing app; confirm the separate right-hand box while all areas remain in the main list, open an attention item, and narrow the window to check the stacked layout. Test no attention items and a long area name. Source is versioned on testing/life-vitals-checklists, based on 9358bab8ad8b133f6d35bcad5ef04bb8a3765a3a, with expected-head publication and remote verification. Deployment workflows are unchanged/manual-only. Production approval remains pending. Local Git metadata remains behind GitHub. Roll back this revision by restoring these three implementation/test files from the parent commit and rebuilding testing; saved data is unaffected. No personal data, generated bundles or profiles are published.

## Production release 3.3.14: Life Vitals action plans and overview (2026-11-11)

User explicitly approved live production for the complete Life Vitals batch. This approval supersedes the historical testing-only/pending-production statements above for checklists, status-first cards, single current priority, and the separate Needs attention panel. Source baseline is testing commit 6093c4b98c1b93d241e229dbf0462b1d537650f7; main before promotion is 7e9a0b5f2c18b4c9b5db6067a236021eac7daf80. Unrelated checkout work remains untouched.

Released behavior: catch-up/maintenance task and subtask lists support sequential or any-order completion; maintenance reset keeps the plan. New check-ins start with status choices directly beneath the title, none selected, and no checklist. Behind reveals Catch-up; On pace reveals Maintenance; Ahead reveals neither. Saved lists remain independent of manually chosen status. Needs attention is a separate right-side panel, stacking below the main list on narrow screens. It includes Behind, never-checked, and seven-day-old check-ins. One current priority is replaceable/clearable and removed on archive.

Release validation: npm run bump:patch set 3.3.14 without a tag; npm test -- --reporter=dot passed 50 files / 525 tests. Existing React act-environment warnings did not fail tests. npm run build passed TypeScript and production Vite. node scripts/package.mjs --versioned successfully created release/Milestone-3.3.14-win32-x64 with the local Electron runtime. All source files under src, electron and scripts matched the approved remote testing tree after line-ending normalization. Prior targeted lint passed; no application code changed during promotion.

Installation verification: copied only differing application files (Milestone.exe and resources/app.asar) from the staged 3.3.14 package into release/Milestone-win32-x64. SHA-256 hashes of the staged and installed archives match. All 76 packaged renderer/Electron files match local build inputs. Embedded metadata and executable FileVersion/ProductVersion are 3.3.14. The existing 3.3.13 versioned package remains available. No profile, credentials, localStorage, testing examples, snapshots or testing data were copied into production. Fresh production Life Vitals remains empty. Optional plans and priority fields require no storage-key migration; existing names, check-ins and manually selected statuses are preserved.

Access: launch the usual Milestone shortcut, which targets release/Milestone-win32-x64/Milestone.exe. An attempt to launch this verified executable through computer control timed out waiting for app approval; a running updated UI is not claimed. Prior testing browser visual inspection was also blocked by connection/session errors. Automated rendered tests and package checks passed, but final desktop visual review remains pending.

Publication: promote approved testing source plus package.json, package-lock.json, CHANGELOG.md and this release record to main with an expected-head check. Workflows were checked against previously inspected manual-only workflow blobs and are unchanged. No hosted deployment or downloadable GitHub Release is claimed or dispatched in this local desktop promotion. GitHub source publication uses the connected tool because local Git metadata is read-only; local HEAD remains behind the remote. Generated release output and personal data are excluded.

Rollback: close Milestone and use release/Milestone-3.3.13-win32-x64/Milestone.exe, or restore that package's application files to the existing production folder. Preserve the production profile; do not copy a testing profile. The previous version ignores optional new fields; retain a backup of current saved Life Vitals before using an older version if later edits will be made. Rebuilding the source requires reverting the production promotion and its included testing feature commits. Remaining limitation: the updated application launch/visual review was not confirmed due to the approval timeout.

## Testing batch: reopen saved Life Vitals checklist (2026-11-11)

Status: testing only on testing/life-vitals-reopen, based on production main 4f68cc3f417ce7f1548e2c1599c1d48e1ea41b8d. This is a new batch and has not been approved for production. No version change, installed-package update, production profile modification, or release/deployment dispatch.

Request and behavior: reopening an area with a latest saved Behind or On pace status immediately shows its saved Catch-up or Maintenance checklist. The top status selector displays that saved status read-only. New check-in is an explicit button at the top: it clears the selection, hides the checklist, and opens a blank check-in form. Choosing Behind/On pace then reveals the appropriate saved plan. Ahead shows neither checklist. Areas with no saved history start directly in a blank new check-in. Cancelling a new check-in or history edit returns to the saved status/checklist. Editing history still selects that record's status and retains its original date. Saving a check-in closes the dialog as before; reopening reflects the newest saved check-in.

Implementation: src/pages/StatusLifeVitalsPage.tsx separates checking-in state from the saved-status view and derives checklist visibility from the relevant status. Checklist mutations remain immediately persisted without creating/editing a check-in, and current priority/Needs attention behavior is unchanged. Checklist draft UI resets when changing between view and check-in modes; already saved tasks and checks persist. No storage schema/key changes or migration. Existing and fresh production data remain unchanged because only the isolated testing build is updated.

Validation: npm test -- src/pages/StatusLifeVitalsPage.test.tsx src/lib/statusVitals.test.ts passed 2 files / 22 tests. node node_modules/eslint/bin/eslint.js src/pages/StatusLifeVitalsPage.tsx src/pages/StatusLifeVitalsPage.test.tsx passed (invoked after tests in the validation command). npm run testing -- --browser passed TypeScript and Vite, and reported serving the stable http://127.0.0.1:4174/ origin. The page suite was repeated after moving New check-in to the top of the card; final result recorded below. Regression tests exercise Behind and On pace reopen, editing/checking a task without new history, close/reopen persistence, blank new check-ins, cancellation, new areas and Ahead. Full repository suite not rerun.

Manual verification: attempted the conversation browser both before and after preview startup; it returned ERR_CONNECTION_REFUSED and then ERR_CONNECTION_TIMED_OUT. No visual pass is claimed. Review by opening an existing Behind/On pace area, checking a task, closing/reopening, starting New check-in, then cancelling. Confirm history count does not change until Save check-in. Existing testing data was not reset and no examples were copied to production.

Publication: only the page source, page tests and this record are published on the new testing branch with expected-head checks and remote verification. Previously inspected workflows remain unchanged/manual-only. Local Git metadata remains behind GitHub because it is read-only; unrelated checkout changes are preserved. Rollback by restoring the two implementation/test files from the parent production commit and rebuilding testing; saved data requires no rollback. Pending: visual review and explicit approval for production.
`nFinal page regression rerun: npm test -- src/pages/StatusLifeVitalsPage.test.tsx passed 1 file / 13 tests after the final button placement change.
