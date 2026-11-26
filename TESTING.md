# Milestone Testing

## Sync repair 2: item-level merging, sync issues, emergency recovery (2026-11-26) — pending review

On `testing/sync-merge-recovery`, based on `main` `4f06760`. Testing only; not approved for production. No version bump, release, deploy or install was performed.

### Request and scope

The user reported that after editing on the iPhone while the laptop and desktop were unused, opening the laptop's Milestone later reverted the phone's changes and removed what had been made on the phone. They asked for the sync issues to be fixed first, then a system that tracks unresolved changes and issues, and an emergency sync system in case it fails again.

### Root cause (reproduced)

Conflicts were settled per store ("slot"): when two devices had both changed quests, the copy written most recently replaced the other wholesale (`preferredForSlot` → `slotVersions.at`). On launch the laptop's daily reset (`checkAndResetRecurring`) changed habits before sync connected; `pullOnce` published that as a local edit first, which made the laptop's clock concurrent with the phone's and its timestamp the newest. The laptop kept its stale copy, published it with a clock that dominated the phone's, and the phone fast-forwarded to it. The phone's version went only to a conflict backup nobody was told about. A failing test reproduced this on the old code before any change (`expected { local: ['a'], published: ['a'] }` instead of `['a', 'p']`); it is now the first case in `src/lib/syncRecovery.test.ts`.

### Behavior

- **Item-level merging** (`src/lib/syncMerge.ts`). Every item — questline, quest, action, habit, step, Vynues project/task/subtask, Life Vitals area/check-in, each heatmap day and history entry, each setting — is merged on its own. Each change carries a dot `[device, count, time, automatic]`; deletions leave tombstones (kept 120 days). Only one side changed it → that side; both → your change beats an automatic one, then the later one, and the other is kept as a sync issue; deleted on one side while edited on the other → kept with an issue; additions always survive. Item lists are normalised identically on every device so a merge is never mistaken for a new edit.
- **Automatic changes** (`src/lib/syncIntent.ts`): the daily reset runs inside `automatic()` (App.tsx), so its changes are stamped automatic and never override a change made by hand elsewhere.
- **Order of work** (`src/lib/cloudSync.ts`): stamp local changes → merge every peer → apply → publish. It no longer publishes before reconciling.
- **Joining**: a device that has never synced takes the group's data and keeps its own items the group never had and never deleted; a first device starts the group.
- **Older builds** (documents without stamps): can add items and change items nobody changed by hand on an updated device; never delete, never undo a hand-made change. On first run an updated device stamps what it holds at the count it last published under 3.4.1 (a "guard"), so a stale device — updated or not — cannot revert work it had not seen.
- **Sync issues** (`src/lib/syncIssues.ts`, synced as a fifth slot `issues`): kind, item name, which device's version was kept, the version that gave way. Restore / Delete it / Keep. Same conflict found on two devices → one entry (id derived from content). Closed issues kept 30 days; max 100.
- **Sync health card** (`src/components/SyncHealthCard.tsx`, Data & backups): status chip, open issues, each device's version / last sync / changes waiting / *Update needed*, Pause/Resume, Sync now, Recover items. Settings button shows a count when issues are open; Settings opens on Data & connections then.
- **Emergency tools**: safety copies in IndexedDB on every device (on open, before each merge that changes data, before each recovery action; newest 30 then one a day for 21 days; `src/lib/syncSafety.ts`); Pause sync; Recover items from another device's copy, a safety copy or a relay copy — lists *Not on this device* (ticked) and *Different here* (unticked) and brings back only the selection as a new change; Replace with this copy; Use this device's data everywhere; Download emergency file (this device, every peer's last copy, issues).
- **Relay history** (`deploy/cloudflare/worker.mjs`): the previous document of a device is kept before it is replaced, at most every 30 min (every time for pre-stamp builds), newest 48 per device, 14 days; `GET /api/history`, `GET /api/history-item?id=`. Clients read it through `readHistory` in `lib/phoneTransport.ts`; older relays answer 404 and are treated as having none.

Runbook and design notes: `docs/sync-recovery.md`. Relay notes: `docs/relay-cloudflare.md`.

### Storage and compatibility

- `milestone-sync-meta` now holds `base` (path → fingerprint of the last stamped copy) instead of `published` (a full second copy of every store), plus `items` (stamps/tombstones) and `protocol: 2`. A 3.4.1 meta is converted once on load.
- New keys: `milestone-sync-issues` (persisted store, synced), `milestone-sync-paused`; IndexedDB database `milestone-sync-safety`.
- Documents gain `items`, `syncProtocol: 2` and `stores.issues`. 3.4.1 clients and the deployed relay accept and ignore them (relay validation checks only quest/vynues/ui). No data migration of the stores themselves.
- Size: on a synthetic 761 KB quest store (5,522 items) exploding takes ~38 ms, a merge ~51 ms; stamps for every item would be ~500 KB, but upgraded devices only stamp what changes (plus one guard per item at upgrade). Uploads grow by the stamps' size.

### Testing versus production

Milestone Testing does not start sync (unchanged), so the merge cannot be exercised live there; the Sync health card is shown in Testing (Not connected) for review of its tools. No production profile, relay, Cloudflare Worker or installed app was touched. Relay history requires deploying the Worker (`cloudflare.yml`), which needs separate approval.

### Validation (cloud workspace, 2026-11-26)

- `npm test`: **57 files, 624 tests passed** (+67: `syncMerge.test.ts` 43 incl. an 8-seed three-device randomised convergence test; `syncRecovery.test.ts` 18; `SyncHealthCard.test.tsx` 6; plus changes below). The randomised test was also run once with 300 seeds × 80 rounds: all converged, no undeleted item lost, no merge re-stamped as an edit.
- `npm run test:sync`: 11 files / 127 vitest + 8 node tests passed (script now includes the new suites).
- `npx tsc -b`, `npm run build`, `npm run cloudflare:prepare`, `npm --prefix deploy/cloudflare run check` (dry run, no deploy), `npm run testing -- --build-only`: passed. `npm run lint`: 13 problems, unchanged from `main`; none in touched files.
- `npm run test:cloudflare` (Miniflare): passed, including history list/item/404/401 and persistence across restart. The pre-existing oversized-payload assertion (`relay.test.mjs:76`) fails intermittently with `fetch failed`; reproduced on unmodified `main` (2 of 15 runs), unrelated to this batch.
- Changed expectations, by design: two `cloudSync.live.test.ts` cases asserted whole-store replacement and conflict backups for concurrent copies — now both sides' items are kept and no backup is needed; one `syncRepair.test.ts` case asserted that a 3.4.1 copy could delete local Life Vitals — now it adds but cannot delete.
- UI: the card was rendered in headless Chrome at 460 px (dark, light) and 390 px (recovery panel open), and inside the real Testing build (1280 px dark, 390 px light: Settings › Data & connections › Manage data › Recover items). No layout breaks seen.

### Manual verification still needed (real devices)

Not run on a real iPhone, laptop or desktop, nor against the live relay. With approval and after deploying all three channels: (1) edit on the phone, open the stale laptop, confirm the phone's edits survive on all three; (2) rename the same task on two devices offline, reconnect, confirm one issue appears and *Use …'s* restores; (3) delete a questline on one device while adding a step to it on another; (4) Pause, edit, Resume; (5) Recover from a safety copy and from a relay copy.

### Known limitations

- Two edits to different fields of the same item on two devices at once keep one version (the other is in the issue).
- Concurrent completions on the same day on two devices can undercount that day's heatmap total (per-day counts merge as values).
- During the changeover, edits made in a device's last session on 3.4.1 to items already changed on an updated device are not applied (recoverable from relay copies).
- A device away longer than 120 days may bring back items deleted meanwhile.

### Rollback

Revert this branch's commit and rebuild. The stores are unchanged; an older build ignores `items`, `syncProtocol`, `stores.issues`, `milestone-sync-issues` and the IndexedDB snapshots. Its whole-store conflict handling returns with it.

### Status

Pending review in Testing and explicit production approval. Production promotion needs the desktop release, Pages, and the Cloudflare deploy together (see `docs/sync-recovery.md`, "Recommended update order").

## Cleanup: stale code and files (2026-11-23) — pending review

On `chore/cleanup`, cut from `release/3.4.1` (`cc1d6af`). The user asked to remove old stale code and unnecessary files while keeping current data. 39 files changed, about 4,600 lines removed. No behavior, storage, sync-format or version change; saved data is not read or written by any of this.

**Removed**

- Unreferenced app files (found by scanning every `src` file for an importer): three banner PNGs replaced in 3.4.0 (8.3 MB); `QuestCard.tsx`, `RoutineCard.tsx`; the earlier Life Vitals pages `LifeVitalsPage.tsx` and `SimpleLifeVitalsPage.tsx` with its test and stylesheet. The Life Vitals data libraries stay: the current page migrates saved data through them.
- The pre-Pondside Today page layout: the `inlineAgenda` switch in `Today.tsx`, its masthead, category select and `DayProgress`, and 53 lines of their CSS. Today now has one layout. Its four tests run against the current layout. `TaskRow`'s full row is **kept**: Systems, Quests and All still render it through `RoutineTaskRow`.
- Self-hosted relay alternatives, unused since the Cloudflare relay: `server/relay.mjs` and its test, `Dockerfile`, `.dockerignore`, `fly.toml`, `render.yaml`, `deploy/oracle/`, `relay.yml`, `docs/relay.md`, `relay-oracle.md`, `relay-render.md`, `scripts/smoke-live-sync.cjs`, and the `relay` npm script. README points to `docs/relay-cloudflare.md`. The app can still talk to any relay that speaks the protocol; only the code to host one elsewhere is gone (it remains in git history).
- Four stray root scripts from August: `.smoke-phone.cjs`, `.smoke-relay.cjs`, `.smoke-systems.cjs`, `.smoke3.cjs`.

**Validation:** `npm test` 54 files, 557 tests passed (4 fewer than 3.4.1: the deleted Life Vitals page's own tests); `npm run test:sync` 50 vitest + 8 node passed (1 fewer: the deleted Node relay's test); `npx tsc -b`, `npm run build`, `npm run cloudflare:prepare`, `npm run testing -- --build-only` passed; lint unchanged at 13 pre-existing problems. Today was re-checked in headless Chrome at 1280px dark with List options open and 390px light: unchanged, no console errors. Other routes were not re-inspected (no code they use changed).

**Local folder cleanup (not a repo change), done the same day with the user's delete approval:** removed `release/Milestone-3.3.11…3.3.15-win32-x64`, `release/.patch-backup`, `Milestone-Mamba.exe`, `app-Mamba.asar`, `dist`, `dist-testing`, `design-studies`, delivered bundles and helper files in `Claude outputs`, and scratch logs/scripts in `.testing` (its `profile`, `session` and `seed.json` were kept). One exe remains: `release/Milestone-win32-x64/Milestone.exe`, carrying the 3.4.1 app archive, with the previous archive beside it as `app-3.3.15-backup.asar`. The checked folder held no production data; that lives in `%APPDATA%\Milestone` and was not touched.

Testing only; awaiting review.

## Current release status — November 23, 2026 (later)

**Sync repair was approved for production by the user on November 23, 2026 ("add these updates") and is prepared as release 3.4.1** on `release/3.4.1`: the `testing/sync-repair` commit plus the version bump and `CHANGELOG.md` entry. 3.4.0 (`dbb4659`) is on `main` with tag `v3.4.0`.

- The work session cannot push or deploy. The user applies the bundle, pushes `main`, runs `release.yml` and `pages.yml`, and deploys the phone app and relay to Cloudflare (by hand, since the `cloudflare.yml` secrets are not set yet).
- Validation of the release commit is the same as the testing commit below; the release commit changes only the version and release notes.

## Sync repair: phone on a stale build, Life Vitals not syncing, sync stalls (2026-11-23) — pending review

### Request and scope

The user reported that the iPhone app "does not work anymore" and asked for the mobile code to be analyzed, for the phone to follow app updates, look like the desktop, and sync live with the desktop and laptop. The exact symptom on the phone was not available. This batch fixes what the investigation could establish and adds the visibility needed to diagnose the rest.

### Findings

1. **The phone's app host was never updated.** `https://milestone-sync.henryhuyvo74.workers.dev/version.json` returned `3.3.10`, built `2026-10-19`, on 2026-11-23, while GitHub Pages returned `3.4.0`. The Cloudflare Worker serves the phone app and is deployed only by a manual `wrangler deploy`; no workflow did it. The phone therefore had none of 3.3.11–3.4.0 (Life Vitals check-ins, Today pin fixes, Pondside). `/api/health` on the Worker was healthy (`configured: true`, `push: websocket`), so the relay itself was up.
2. **Life Vitals never synced.** It is saved under its own storage key (`milestone-status-vitals-v1`), outside the three synced stores, and was also missing from conflict backups.
3. **One unreadable device stopped all syncing.** `pullOnce` returned early with "A device sent invalid sync data" if any peer document failed validation, including documents from devices that are no longer used.
4. **A clock that went backwards stalled a device permanently.** The Worker answers 409 "older snapshot" when a device's document clock is behind the one it holds. Nothing recovered from that, so every later write was refused too. This can follow a restored profile or cleared site data.
5. **No way to see which build a device is on.** Sync documents carried no version, so a stale device was indistinguishable from a healthy one.
6. Desktop releases 3.3.9–3.3.15 have no GitHub Release tag (tags go 3.3.8 → 3.4.0), so a second computer could only have updated through 3.4.0's release. Not a code defect; noted because it explains a laptop that was behind.

Not established: what the phone actually shows. The deployed 3.4.0 web build was loaded at phone width in desktop Chromium and booted with no errors, so 3.4.0 itself is not obviously broken; iOS Safari was not tested.

### Changes

- **Life Vitals is a fourth sync slot (`vitals`)** with its own clock: `lib/vitalsSync.ts`, `lib/cloudSync.ts`, `pages/StatusLifeVitalsPage.tsx`. Saving a check-in publishes it; an open Life Vitals page reloads when another device's check-ins arrive. An empty list is never published, so a device that has not used Life Vitals cannot replace real check-ins with nothing. Included in conflict backups. Builds before this ignore the slot.
- **Unreadable peers are skipped, not fatal.** The device is named in a standing warning that clears itself once fixed.
- **Stale-clock recovery.** On a 409 "older snapshot" the client reads its own document back from the relay, merges that clock and retries once. Works against the Worker already deployed (it asks `/api/peers` with no matching device id). `lib/phoneTransport.ts`, `lib/cloudSync.ts`.
- **Versions are visible.** Each sync document carries `appVersion`; the sync cards list each device with its version and say when they differ. `components/PhoneCard.tsx`, `CloudSyncCard.tsx`.
- **`.github/workflows/cloudflare.yml`** (manual dispatch) builds, tests and deploys the phone app and relay. Needs repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `docs/relay-cloudflare.md` documents it and the by-hand equivalent.
- Install colors match Pondside: `theme_color` and `background_color` in `public/manifest.webmanifest` and the `theme-color` meta in `index.html` are `#12201e`.

### Storage and compatibility

No migration. New local key use: none (Life Vitals keeps its key). Sync documents gain an optional `appVersion` and an optional `stores.vitals` / `slotClocks.vitals`; older builds and the deployed relay accept and ignore both. The Worker code is unchanged. First exchange after updating: a device with Life Vitals publishes them; a device without adopts them; if two devices both hold different Life Vitals, the most recently published wins and the other is saved as a sync backup, as for any other slot.

### Validation (cloud workspace)

- `npm test`: **55 files, 561 tests passed** (10 new in `lib/syncRepair.test.ts`: Life Vitals publish, republish on save, adoption with page event, empty list never published, malformed slot rejected, bad peer skipped and named, peer versions reported, stale-clock recovery and its failure path, 409 handling and own-document read over HTTP).
- `npm run test:sync`: 50 vitest + 9 node tests passed. `npm --prefix deploy/cloudflare test`: 1 passed (Miniflare runtime). `npm --prefix deploy/cloudflare run check` (dry run): passed, no deploy.
- `npx tsc -b`, `npm run build`, `npm run cloudflare:prepare`, `npm run testing -- --build-only`: passed. `npm run lint`: unchanged, 13 pre-existing problems outside this work.

### Not verified

- Anything on the real iPhone, laptop or desktop, or against the live relay with real data. No device was paired, no real document was read.
- The new workflow has never run; the Cloudflare secrets are not set.
- Two real devices exchanging Life Vitals end to end through the Worker (covered by unit tests with a mocked route only).
- iOS Safari rendering of 3.4.0.

### Known limitations

- Devices that are no longer used stay on the relay as documents (limit 16). There is no control to remove one yet.
- Sync replaces a whole slot; two devices editing tasks at the same moment still resolve to one side plus a backup.
- The phone only receives changes while the app is open; iOS suspends it in the background and it catches up on reopen.
- GitHub Pages and the Cloudflare address are separate installs with separate storage on the phone. Only one should be on the home screen.

### Approval

Approved for production on 2026-11-23 as 3.4.1 (see the release status above).

## Current release status — November 23, 2026

**Pondside Batches 1 and 2 were approved for production by the user on November 23, 2026 ("Push both into production") and are prepared as release 3.4.0.** The sections below were written while the batches were pending review and are kept as the record of that review.

- **Release commit:** on `release/3.4.0`, a fast-forward of `main` (`b6324f0`). It contains the two testing commits plus the promotion changes: the Pondside Today is now the default layout in every build (it was gated to testing mode), the version is 3.4.0, and `CHANGELOG.md` has the release notes.
- **Regression found and fixed during promotion:** the Pondside row had moved "Unpin from Today" into the More menu, which hid the always-visible unpin control released in 3.3.13 (including on completed quests). It is back on the row as a pin button; `todayQuestPinExpiry.test.ts` caught it once the layout became the default.
- **Validation of the release commit (cloud workspace):** `npm test` 54 files, 551 tests passed; `npx tsc -b` passed; `npm run build` (production) passed; `npm run testing -- --build-only` passed; `node --test electron/desktop.test.cjs` 7 passed; `npm run lint` unchanged at 13 pre-existing problems outside this work. The production build was served with `vite preview` and Today was seen in light theme: Pondside layout, no testing banner, version chip v3.4.0, bundled fonts loaded, no console errors.
- **Not done from the work session:** it has read-only access to `hvo7/Milestone`, so `main` was **not pushed**, and the `pages.yml` and `release.yml` workflows (manual dispatch) were **not run**. No installed app was patched. Until the push and the two dispatches happen, production is still 3.3.15.
- **Not verified:** the packaged Windows build, the installed-app update, the deployed PWA, and real production data (only a synthetic fixture was used).

## Pondside · Batch 2: Quests two-pane (2026-11-23) — pending review

### Request and scope

After Batch 1 the user asked for the Quests tab revamp in the same run. This applies the approved board "Approved · Quests (Pondside, two-pane)" to `/quests`. Presentation only; quests, steps, pins, edit mode, the General bucket, supporting systems and linked tasks keep their behavior. Batch 1 has not been reviewed yet; the two batches are separate commits so either can be judged on its own.

### What to review

- **Header.** Bridge banner, "Quests", then Edit (quiet), New questline (secondary), New quest (gold). New quest is disabled while General is selected.
- **Left pane, coldest first.** Questlines as cards: art tile, name, quiet-goal dot with a factual reading, and `done / total`. Gold "Quiet 19 days" once a goal is cold (21+ days, or never moved after its first week: "Quiet so far"); leaf "Moved today"; plain otherwise ("Moved 6 days ago", "Not started", "Complete"). The selected card has a 2px water inset ring. General is the last card with its open-task count. With nothing chosen the coldest questline is shown.
- **Right pane.** Large art tile, title (click to edit, plus Edit and Delete icon buttons), momentum chips (last moved · tasks in 30 days · time left at current pace when there is enough history · Sequential · cadence · target date), water progress bar with "4 of 12". Quests are nested rows: done shows the water check, the current quest of a sequential questline has a gold ring and is open with its steps, locked shows a lock icon. A pinned quest or step shows an "On Today" chip (the chip is the unpin control); an unpinned one shows a pin icon. Supporting systems, Linked tasks and "Momentum across questlines" follow below.
- **Phone (760px and below).** The panes stack: the list is the page; choosing a questline or General opens it as its own view with Back.
- Momentum is never red and carries no guilt copy.

### Implementation and affected files

- New: `components/QuestlineColdList.tsx`, `pages/questsPondside.css`, `pages/QuestsPage.pondside.test.tsx`.
- Changed: `pages/QuestsPage.tsx` (layout, coldest-first selection, phone view), `components/QuestlineAccordionItem.tsx` (detail-mode panel header and row classes; the accordion used on Space pages keeps its structure), `components/ActionItem.tsx`, `QuestDoneToggle.tsx` (lock icon), `PinButton.tsx` ("On Today" chip / pin icon, replacing the emoji everywhere it is used), `Icon.tsx`, `lib/momentum.ts` (`quietSignal`, `etaChip`; `momentumHex` now returns tokens), `lib/controlConsistency.test.ts`.
- `QuestlineSidebar.tsx` is unchanged and still used by Systems.

### Decisions and differences

- **Manual questline order is not editable from Quests.** The list is sorted by momentum, so "Edit order" is no longer on this tab. The saved order is untouched and still shown and editable on Systems.
- "Tasks in 30 days" counts completions credited to the questline in the trailing 30 days (the existing `movement.moves`).
- The "current" gold ring applies to sequential questlines only; in a flexible questline every unlocked quest is equal, as before.
- Uppercase DONE / LOCKED labels became the check, the lock icon and "n of m".

### Storage and compatibility

None. No store, key, schema or preference changes.

### Validation (cloud workspace, 2026-11-23)

- `npm test`: **54 files, 551 tests passed** (5 new in `QuestsPage.pondside.test.tsx`: quiet-goal wording and tones; coldest-first order, default selection and saved order untouched; chips, progress and re-sort after a step is checked; done/current/locked and the On Today chip; General, Back, edit mode and the New quest gate). Two existing tests were updated for intended changes (pin resting opacity, Search in the toolbar order from Batch 1).
- `npx tsc -b`, `npm run testing -- --build-only`: passed. `npm run lint`: the same 13 pre-existing problems outside this work; changed files are clean apart from that pre-existing warning. `node scripts/check-contrast.mjs`: all pairings pass.

### Visual check: what was actually seen

Headless Chrome against the testing build, synthetic fixture, no console errors.

- **Seen:** 1280px dark and light (sequential questline, current quest open, locked quest, On Today chip, supporting systems, linked tasks); 1024px dark in edit mode; 720px light (stacked list); 390px dark list and 390px light detail with Back; General selected at 1280px dark.
- **Captured but not inspected:** empty state light; Space page dark.
- **Not verified:** a "Quiet n days" gold card on screen (the fixture had no history that old; covered by tests); hold-to-reorder of quests; the Electron window; physical touch; create/edit drawers opened from this page.

### Known limitations

- General and Linked tasks rows use the older `RoutineTaskRow`, which keeps its outlined card and puts its pin and delete on a second line at narrow widths.
- Space pages show the same accordion in its older layout with the new palette.
- The questline page route (`/questline/:id`) is unchanged.

### Approval

Testing only. **Awaiting the user's review. Not approved for production.**

## Pondside · Batch 1: foundation + Today (2026-11-23) — pending review

### Request and scope

The user approved the Pondside direction (boards B · Today dark/light, B · Phone Today and the subtle feedback set) and asked for the new appearance in testing. This batch replaces the visual foundation for the whole app and rebuilds Today. It changes presentation only. Quests is Batch 2 and is not built.

**Base.** The prompt assumed `testing/today-agenda` still carried the inline Today agenda. Its tip (`94ba784`) is the November 22 revert, so the agenda existed only at `65a4160`. The user was asked and chose to build on `65a4160`. This branch is cut from the `94ba784` tip (no history rewrite) and restores the agenda's application files from `65a4160`: `Today.tsx`, `TaskRow.tsx`, `chrome.tsx`, `FirstRunCard.tsx`, `NavBar.tsx`, `TaskCreateDrawer.tsx`, `uiStore.ts`, `todayAgenda.css`, `Today.test.tsx`, `Today.navigation.test.tsx`. `todayInline.css` is replaced by `todayPondside.css`. **This reinstates agenda behavior that was withdrawn on November 22**, by the user's choice for this batch.

### What to review

- **Palette and type, everywhere.** Deep pond-green dark theme and paper-cream light theme. Fraunces for titles and the wordmark, Nunito Sans for everything else, both bundled (no network font requests). Pill buttons and tabs, soft surface cards, no borders between items, one soft shadow on modals, drawers and toasts only.
- **Navigation.** Same tabs, restyled as pills, with a gold count badge. A Search button joins +, theme, reload and settings (Ctrl K and / still work). At 480px and below the header keeps wordmark, search and settings; Theme and Space tabs are also in Settings so nothing is lost on a phone. Reload has no phone control in this batch.
- **Page art.** The watercolor is now a banner card at the top of the content column (200px, 112px on phone): pond on Today and All, bridge on every other route. On Today it carries the date pill. Other routes show their title under the banner. Settings › General › **Show page art** (default on) removes it with no space left behind.
- **Today.** Banner, then tasks beside a habits rail. Header: Today, List options, gold New task; a water progress bar with "2 of 7". Category chips with open counts. Task rows are cards: art tile, title, one meta line, check ring on the right. A row opens in place with steps (thin guide line), counters or sessions, Edit, Remove and More. Habits rail: progress ring (also the check), name, progress text, leaf + streak count, round + for counters and session goals. "Last 12 weeks" heatmap panel with round cells. Completed and Activity history stay as disclosures. List options holds Today/Tomorrow, All/Systems/Quests, Show skipped and Restore.
- **Phone (480px and below).** Scrolling pill tabs, compact banner, task cards, habits as a 3-up grid of ring tiles (an open habit takes the full row), New task as a full-width gold bar pinned above the safe area.
- **Feedback.** Check: the ring fills over 180 ms and the check draws, then the row moves to Completed. Day closed: at 100% the bar becomes a closed ring with "Today's list is clear" and today's heatmap cell fills; the closing animation plays once per logical day. Quest complete: the undo toast shows the questline's art tile, "Quest complete · {quest}" and, in a sequential questline, "{next quest} unlocked"; Undo (12 seconds) restores the quest data, completion log and task history. Streaks are a plain count. No sound, confetti or bounce.

### Implementation and affected files

- `src/index.css`: semantic tokens (`--bg`, `--surface`, `--raised`, `--sunken`, `--line`, `--ink`, `--ink-dim`, `--ink-faint`, `--gold`, `--gold-ink`, `--water`, `--leaf`, `--danger`, `--heat-0…4`), per-theme category colors, and every legacy variable (`--accent*`, `--gold*`, `--dark-bg`, `--card-*`, `--text-*`, `--page-*`, `--nav-*`, `--input-*`, `--success`, `--sb-*`, `--track-bg`, `--modal-bg`) remapped onto them. Shared primitives restyled: nav, banner, buttons (`.btn-gold` primary, `.btn-ghost` secondary, `.btn-quiet`, `.btn-danger`, `.icon-btn-round`), chips, inputs, check control, progress bar and ring, toast, switch, empty state, focus ring. No raw color values remain outside the token block.
- `src/motion.css` + `src/lib/motion.ts`: duration tokens; reduced motion sets them to 0. Script-driven motion (row expand, check fill, reload spin) reads the same tokens.
- New: `components/Icon.tsx` (one stroke icon set), `ProgressRing.tsx`, `PageBanner.tsx`, `lib/dayClosed.ts`, `lib/questComplete.ts`, `pages/todayPondside.css`, `scripts/check-contrast.mjs`, `pages/Today.pondside.test.tsx`.
- Changed: `NavBar.tsx`, `CommandPalette.tsx`, `SettingsModal.tsx` + `settings.css`, `ModalShell.tsx`, `UndoToast.tsx`, `UpdateToast.tsx`, `lib/undo.ts` (optional `detail`/`art` on an entry), `Heatmap.tsx` (weeks, compact, round cells), `ProgressBar.tsx`, `today/TaskRow.tsx` (Pondside row), `today/chrome.tsx` (`PondProgress`), `today/ProgressStrip.tsx`, `recurrence.tsx`, `lib/ui.ts` (category colors resolve to theme tokens), `RoutineCard.tsx`, `MomentumPanel.tsx`, `Today.tsx`, `uiStore.ts`, `lib/controlConsistency.test.ts`, `package.json`/`package-lock.json` (two font packages; version not bumped).
- The Pondside Today is behind the existing `inlineAgenda` gate (on in testing mode). A non-testing build of this branch would show the earlier non-inline agenda layout with the new palette.

### Decisions that differ from the written spec

- **Light-theme accent values.** The approved light swatches for gold, water, leaf and danger measure 3.75–4.34:1 on `--raised`. They are a few points darker here (`#8b5c13`, `#27706a`, `#377235`, `#ab4437`) so every text pairing reaches 4.5:1. `--heat-4` keeps `#2c7f78`. Dark values are exactly as approved.
- **Rail breakpoint vs. 560px minimum.** The rail drops below the list at 720px as instructed. Between 721px and about 1000px the task column is therefore narrower than 560px (about 400px at 760px).
- **Banner art.** Only pond and bridge are used, as specified. The riverside and Systems scenes approved earlier are no longer shown; their files are untouched.
- **Day progress** moved from List options to the header, so it is always visible. Semantics are unchanged (skips excluded, filters ignored).
- **Category filter** is the chip row; the kind filter (All/Systems/Quests) stays in List options.
- **Habit + button** appears on counters and session goals only. A plain habit is checked by tapping its ring. − is in the open row.
- **Reset time** is whatever Settings holds (default 02:00), not a fixed 5am; unchanged by this batch.
- Settings lost its two gray intro subtitles (concise-UI rule). The testing banner now reads "TESTING · Pondside".

### Storage and compatibility

No schema, store, storage-key or migration changes. Two optional fields were added to the existing `milestone-ui` store: `showPageArt` (absent = on) and `dayClosedOn` (the logical day whose day-closed animation has played). Older builds ignore both. `hiddenAgendaRows` returns with the agenda, as before. Nothing is synced or copied to production.

### Validation (cloud workspace, 2026-11-23)

- `npm test` (`vitest run`): **53 files, 546 tests passed**. 7 new tests in `Today.pondside.test.tsx` cover: day closed at 100% and once per logical day (including reload and next day), Tomorrow never closing, quest-complete toast content and Undo restoring all three slices, no "unlocked" line when not sequential, page-art preference (default, off, persisted, legacy save), and the check fill with and without reduced motion. The existing 12 agenda journeys pass against the new markup.
- `npx tsc -b`: passed. `npm run testing -- --build-only`: passed (TypeScript + Vite, `dist-testing`). `node --test scripts/testing-preview.test.mjs`: 1 passed.
- `npm run lint`: **13 problems (12 errors, 1 warning), all in files this batch did not write** (`VynuesTaskCreateDrawer.tsx`, `vynuesUi.tsx`, others). The branch base reports 14. ESLint on the files this batch added or changed reports only that pre-existing warning.
- `node scripts/check-contrast.mjs`: all pairings pass.

```
dark
  pass  14.79:1  (min 4.5)  --ink on --bg
  pass   8.83:1  (min 4.5)  --ink-dim on --bg
  pass   8.70:1  (min 4.5)  --water on --bg
  pass  10.33:1  (min 4.5)  --leaf on --bg
  pass   9.20:1  (min 4.5)  --gold on --bg
  pass   6.97:1  (min 4.5)  --danger on --bg
  pass   8.40:1  (min 4.5)  --color-crimson on --bg
  pass   9.13:1  (min 4.5)  --color-sapphire on --bg
  pass   9.41:1  (min 4.5)  --color-emerald on --bg
  pass   9.66:1  (min 4.5)  --color-amber on --bg
  pass   8.80:1  (min 4.5)  --color-violet on --bg
  pass  12.88:1  (min 4.5)  --ink on --surface
  pass   7.69:1  (min 4.5)  --ink-dim on --surface
  pass   7.58:1  (min 4.5)  --water on --surface
  pass   9.00:1  (min 4.5)  --leaf on --surface
  pass   8.02:1  (min 4.5)  --gold on --surface
  pass   6.07:1  (min 4.5)  --danger on --surface
  pass   7.32:1  (min 4.5)  --color-crimson on --surface
  pass   7.96:1  (min 4.5)  --color-sapphire on --surface
  pass   8.20:1  (min 4.5)  --color-emerald on --surface
  pass   8.41:1  (min 4.5)  --color-amber on --surface
  pass   7.67:1  (min 4.5)  --color-violet on --surface
  pass  10.65:1  (min 4.5)  --ink on --raised
  pass   6.36:1  (min 4.5)  --ink-dim on --raised
  pass   6.26:1  (min 4.5)  --water on --raised
  pass   7.44:1  (min 4.5)  --leaf on --raised
  pass   6.63:1  (min 4.5)  --gold on --raised
  pass   5.02:1  (min 4.5)  --danger on --raised
  pass   6.05:1  (min 4.5)  --color-crimson on --raised
  pass   6.58:1  (min 4.5)  --color-sapphire on --raised
  pass   6.78:1  (min 4.5)  --color-emerald on --raised
  pass   6.96:1  (min 4.5)  --color-amber on --raised
  pass   6.34:1  (min 4.5)  --color-violet on --raised
  pass   9.02:1  (min 4.5)  --gold-ink on --gold
  pass  14.79:1  (min 4.5)  --bg on --ink
  pass   8.70:1  (min 4.5)  --bg on --water
  pass   5.57:1  (min 3)  --ink-faint on --bg
  pass   4.85:1  (min 3)  --ink-faint on --surface
  pass   6.26:1  (min 3)  --water on --raised

light
  pass  11.93:1  (min 4.5)  --ink on --bg
  pass   5.50:1  (min 4.5)  --ink-dim on --bg
  pass   5.07:1  (min 4.5)  --water on --bg
  pass   5.05:1  (min 4.5)  --leaf on --bg
  pass   5.03:1  (min 4.5)  --gold on --bg
  pass   5.06:1  (min 4.5)  --danger on --bg
  pass   5.35:1  (min 4.5)  --color-crimson on --bg
  pass   5.41:1  (min 4.5)  --color-sapphire on --bg
  pass   5.18:1  (min 4.5)  --color-emerald on --bg
  pass   5.51:1  (min 4.5)  --color-amber on --bg
  pass   5.61:1  (min 4.5)  --color-violet on --bg
  pass  13.35:1  (min 4.5)  --ink on --surface
  pass   6.15:1  (min 4.5)  --ink-dim on --surface
  pass   5.67:1  (min 4.5)  --water on --surface
  pass   5.66:1  (min 4.5)  --leaf on --surface
  pass   5.63:1  (min 4.5)  --gold on --surface
  pass   5.67:1  (min 4.5)  --danger on --surface
  pass   5.99:1  (min 4.5)  --color-crimson on --surface
  pass   6.05:1  (min 4.5)  --color-sapphire on --surface
  pass   5.80:1  (min 4.5)  --color-emerald on --surface
  pass   6.17:1  (min 4.5)  --color-amber on --surface
  pass   6.28:1  (min 4.5)  --color-violet on --surface
  pass  10.80:1  (min 4.5)  --ink on --raised
  pass   4.98:1  (min 4.5)  --ink-dim on --raised
  pass   4.59:1  (min 4.5)  --water on --raised
  pass   4.58:1  (min 4.5)  --leaf on --raised
  pass   4.55:1  (min 4.5)  --gold on --raised
  pass   4.59:1  (min 4.5)  --danger on --raised
  pass   4.84:1  (min 4.5)  --color-crimson on --raised
  pass   4.90:1  (min 4.5)  --color-sapphire on --raised
  pass   4.69:1  (min 4.5)  --color-emerald on --raised
  pass   4.99:1  (min 4.5)  --color-amber on --raised
  pass   5.08:1  (min 4.5)  --color-violet on --raised
  pass   5.55:1  (min 4.5)  --gold-ink on --gold
  pass  11.93:1  (min 4.5)  --bg on --ink
  pass   5.07:1  (min 4.5)  --bg on --water
  pass   3.25:1  (min 3)  --ink-faint on --bg
  pass   3.64:1  (min 3)  --ink-faint on --surface
  pass   4.59:1  (min 3)  --water on --raised

All pairings pass.
```

Custom questline colors picked by the user are not covered by this check.

### Visual check: what was actually seen

Rendered from the testing build served by `scripts/testing-preview.mjs` at `http://127.0.0.1:4174/` in headless Chrome, with a synthetic fixture in a throwaway profile. No console errors in any capture.

- **Seen, Today:** 1280px dark and light; 1024px light (long title wrapping to three lines, 12 habits); 720px dark (rail below the list, long title, 12 habits); 390px dark and light. States: a row open with nested steps and guide line; a habit open with checkpoint pips; List options open; Tomorrow preview (read-only, no + buttons); a category chip filter; 100% done (closed ring, filled heatmap cell) dark 1280 and light 390; an empty day light 1280 and dark 390; page art off; quest-complete toast dark and light; Remove toast on phone above the New task bar; New task drawer; Settings at 1280 dark and 390 light; search palette.
- **Seen, other routes:** Quests dark, Systems light, All dark, Life Vitals light. Legible, layouts unchanged.
- **Captured but not inspected:** Life Vitals dark, Systems dark, Quests light, questline page and space page in both themes, All light, 1024px dark, 720px light.
- **Not verified:** the Electron testing window; a physical phone, touch and safe-area insets; pointer drag reordering; the animations themselves (check fill, day-closed ring, reduced motion) were tested in code but not watched; hover and focus-ring appearance; create/edit/save, Undo and theme/page-art toggles were exercised by tests, not clicked in a browser. Life Vitals keeps its own status gradients and left accents from its approved batch.

### Known limitations and pending work

- On other routes the banner is 1160px wide while some page columns are wider or narrower; alignment is not tuned.
- Drawers, Life Vitals, Systems, Quests and All pages still contain inline styles and a few raw colors in files this batch did not touch; they inherit the palette through the aliases.
- No Reload control on phone.
- Batch 2 (Quests two-pane, quiet-goal dot) is not started.
- **Publication:** the work session had read-only access to `hvo7/Milestone`; the branch was not pushed from it. See the handoff for the remaining action.

### Testing and production boundary; approval

Run `npm install` (two new font packages), then `Open Testing.cmd` or `npm run testing`; for a conversation review `npm run testing -- --browser` and open `http://127.0.0.1:4174/`. Testing only: no production launch, patch, publish or release. **Awaiting the user's review. Not approved for production.**

## Current testing status — November 22, 2026

**All pending feature batches are withdrawn.** The user requested a return to the approved Milestone 3.3.15 interface, including removal of the Life Vitals ASAP experiment. This status supersedes older review and promotion notes below.

- Restored the original Today cover, task list, habit rail, progress and day switch, shared task controls and creation drawer. Both agenda iterations, their styles and tests, and the standalone Today design studies were removed from the active checkout. Restored the approved Life Vitals Needs attention panel and its original checklist behavior.
- Reference commit: `b6324f0af8d9467312672a1bc10f0303578b45a7` on `main`. The two testing branches receive ordinary rollback commits. Their application files match the approved source. The documentation records the withdrawal and the standing desktop-control preference. All three publishing workflows were checked and require manual dispatch. No production release or installation was requested.
- Restored 12 changed source and test files and removed four agenda-only files. A separate comparison checked 212 release files in `src`, `scripts`, `electron`, `package.json` and `vite.config.ts` using Git blob hashes, allowing checkout line-ending differences. No other application, launcher or test source differed. Saved tasks, habit history and profiles were preserved. Older testing UI preferences for dismissed agenda rows are ignored by the restored code. No data migration or version change was necessary.
- `npm run testing -- --build-only` passed TypeScript and Vite; `dist-testing` contains the restored Today and Life Vitals views. The built JS and CSS passed checks for the original layout selectors and absence of withdrawn agenda markers.
- `npm test -- --maxWorkers=5 --reporter=dot` passed all 527 tests across 50 files. An additional temporary testing-mode route check passed using synthetic data: the original Today cover and habit rail rendered, an anchor habit could be checked and unchecked, the new-task drawer opened and cancelled, and the day switch moved to Tomorrow and back. The temporary check was removed after use. Verification used the workspace; visual appearance, physical touch and motion were not observed in this session.
- Reopen the isolated app with `Open Testing.cmd` to load the rebuilt version. Prior experiments remain recoverable from Git history at `65a4160` (Today) and `b957509` (ASAP). Local Git metadata is read-only at `c218de8`; the connected repository records the testing-branch rollbacks.

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

## Production release 3.3.15: reopen saved Life Vitals plans (2026-11-11)

User explicitly approved production for the reopening batch. This supersedes its testing-only approval status above. The release promotes testing/life-vitals-reopen commit 1a494256b80124ae1e858925f65d86ce46a0e8cc onto main, whose prior head is 4f68cc3f417ce7f1548e2c1599c1d48e1ea41b8d.

Behavior: reopening Behind/On pace areas immediately shows the saved Catch-up/Maintenance list alongside the read-only latest saved status. Checklist edits do not create check-ins. New check-in is available at the top and starts with no selection/list; choosing Behind/On pace reveals that plan. Cancel returns to the saved state. Areas with no history start blank; Ahead does not show a checklist. History editing, current priority, Needs attention, and manual status semantics remain intact.

Storage and compatibility: no schema, key, migration, or profile changes. Existing lists and check-in history are preserved; no testing examples, testing localStorage or credentials are copied. Fresh production continues to start empty. Only runtime application files are promoted. Prior versioned 3.3.14 remains available for rollback.

Release preparation: npm run bump:patch advanced package.json/package-lock.json to 3.3.15 without a Git tag; CHANGELOG.md records this release. Runtime/source files under src, electron and scripts match the approved remote testing tree after line-ending normalization. Deployment workflow blobs match the previously reviewed manual-only workflows; no workflow changes or dispatches are included. Full validation and installation results follow below.

Distribution and limitations: this is the local Windows desktop update and GitHub source promotion, not a hosted deployment or downloadable GitHub Release. The native app was listed as open, but its accessibility state was unavailable and its screenshot did not expose the intended app content; no production UI edits or visual pass are claimed. Restart the usual Milestone shortcut after installation to load the new bundle. Local Git metadata remains behind remote because it is read-only. Existing unrelated checkout work is preserved.

Rollback: close Milestone and launch release/Milestone-3.3.14-win32-x64/Milestone.exe, or restore that package's application files to release/Milestone-win32-x64. Keep the production profile unchanged. No data migration needs reversal. Do not restore a testing profile. Source rollback requires reverting this promotion and its included reopening commit; simply reverting release metadata would not revert behavior.

Validation and current installation status: npm test -- --reporter=dot passed 50 files / 527 tests (existing React act-environment warnings only). npm run build passed TypeScript/Vite; node scripts/package.mjs --versioned built release/Milestone-3.3.15-win32-x64. The installer verified its embedded version and all runtime files before attempting replacement, but copying Milestone.exe failed with EBUSY because the running production app holds the executable open. Installed executable metadata remains 3.3.14; installation is NOT complete and this record does not claim that 3.3.15 is running. Native control subsequently exposed the 3.3.14 UI; repeated clean-close actions did not remove its window. No force termination was performed. No profiles were modified by installation.

Remaining action: user must fully quit Milestone (including Quit from its tray menu if applicable). Then rerun the prepared installation from the staged 3.3.15 folder into the production folder and verify matching archive hashes, executable metadata, and runtime inputs before claiming live installation. No rebuild or version bump is required. Approved source is promoted to main now, with this exact outstanding installation blocker recorded. Generated package remains local and excluded from GitHub source publication.

## Today task list and daily habits (2026-11-22)

**Testing review pending.** Henry selected an ordered task list as the first thing to see on Today, with daily habits alongside it. The source branch is `testing/today-agenda`, based on production source commit `b6324f0af8d9467312672a1bc10f0303578b45a7`. Promotion requires approval for this batch.

### What to review

- Open Today. The main column starts with the saved task order. The daily habits panel sits to its right above 800 px and follows the task list at narrower widths. Its header uses the existing pond artwork. Each habit appears once, with its existing check-off, counter, steps and editing controls. **Add habit** opens the creation drawer with the habit category selected.
- Task titles lead each row. Use **New task** to add work, drag or use the grip's arrow keys to reorder, and expand **Completed** to inspect or reopen settled work. Completion and activity history start collapsed. Systems, Quests, category and skipped controls appear when applicable. Drag and keyboard reordering are available on the full Today list so a filtered subset cannot change the order of hidden categories.
- Day progress includes eligible tasks and habits across all sources, even when a list filter is active. It excludes skips. A multi-day goal with today's session logged counts toward the day. Use **Tomorrow** in the header to preview the next logical day. A new one-off task created there starts with that day as its editable due date. Check-off and reorder controls are unavailable for the preview.

### Implementation and compatibility

`src/pages/Today.tsx` retains the existing task eligibility, pin-expiry, reset and ordering logic and renders the main list, settled work and habit rail using the existing task row. `src/components/today/TaskRow.tsx` exposes styling hooks. `src/pages/todayAgenda.css` scopes the new layout and styles to Today. `src/components/today/chrome.tsx` provides the day switch and native progress indicator. `src/components/FirstRunCard.tsx` keeps optional example questlines available in an empty app. `src/components/NavBar.tsx` identifies the testing view. `src/components/TaskCreateDrawer.tsx` takes an optional initial date and initializes each new form on mount. The default date for other entry points remains empty.

Existing stores and date keys supply all state. The batch adds no schema, migration, profile, dependency, image download or version bump. The desktop test launcher reads the usual backup into its private testing copy. The conversation browser uses separate test storage. Only Today source, the four synthetic interaction tests, and this record belong to this batch.

### Validation and visual review

- `npm test -- src/pages/Today.test.tsx --reporter=dot` passed all four cases. They exercise ordered tasks and exclusive habit placement, keyboard reorder, completion and reopening, filtering and skipped progress, creating a dated task for Tomorrow, and opening the habit drawer on an empty day.
- `npm test -- --reporter=dot` passed 534 tests across 51 files in the shared checkout. This includes other existing local tests. Some older suites printed React act-environment warnings.
- `node node_modules/eslint/bin/eslint.js src/pages/Today.tsx src/pages/Today.test.tsx src/components/today/chrome.tsx src/components/today/TaskRow.tsx src/components/TaskCreateDrawer.tsx src/components/FirstRunCard.tsx src/components/NavBar.tsx` passed.
- `npm run testing -- --browser` started the testing build and local preview. The final `npm run testing -- --build-only` passed TypeScript and Vite and refreshed `dist-testing`. The conversation panel timed out twice at `http://127.0.0.1:4174/`. The local HTTP probe reported socket access denied. `npm run testing` and the attached launcher built the desktop test app but produced no fresh screenshot. A separate offscreen Electron layout check exited before rendering. Desktop and narrow-screen visual inspection remain pending.
- For review, use the same loopback address with `npm run testing -- --browser`, or open the repository's `Open Testing.cmd` for the isolated desktop app. Check a populated day with long titles, counters and daily habits in both themes, then narrow the window and check the list-first order. Verify the first visible task still matches the saved order after reloading.

The testing branch contains only source versioning. The three remote deployment workflows use manual dispatch. Local Git metadata is read-only and stays at `c218de8`. The unrelated Life Vitals testing batch stays on its own branch. For rollback, revert this batch on its testing branch and rebuild with `npm run testing -- --build-only`. Saved data needs no conversion.

## 2026-11-22 — Today reference layout in the testing app

The user approved the warm-white Today reference for testing and selected the thin vertical line beside expanded subtasks. The screen uses compact navigation, a single list with fine horizontal dividers, circular completion controls, a text New task action and a narrower Daily habits column. At widths of 720 CSS pixels and below, the current layout places habits after the task list. The mobile comparison also shows a Tasks / Habits switch for design review. Both comparison images use illustrative tasks.

### Behavior and data

- The testing landing route uses the real task, project, quest and habit stores. One title at a time opens in place. Its category, schedule, applicable counter or session controls, steps and Edit and Remove actions appear underneath. Pressing Escape in the expanded row returns focus to its title. Reordering still uses the grip and arrow keys. The reveal uses 140 ms and skips the transition when reduced motion is requested.
- Edit opens the existing editor inside a native modal dialog on the testing route. Save, Cancel and Escape return to the list. New task and Add habit use the same dialog shell and existing creation forms. The Tomorrow preview offers planning and keeps row actions read-only.
- Remove dismisses an item from the selected logical day. Undo restores the latest removal, and List options offers a Restore button for each dismissed item, including after reload. Dismissal, completion and unpinning are distinct actions. List options also provides Today/Tomorrow, filters and total progress. Completed items and activity history retain their disclosures.
- Changes live in `src/pages/Today.tsx`, `src/pages/todayInline.css`, `src/components/today/TaskRow.tsx` and `src/uiStore.ts`. The new layout defaults on only for Vite testing mode. The optional `hiddenAgendaRows` preference contains one logical date and a list of IDs in the testing UI store. Existing profiles need no conversion. No profile, seed, credentials, screenshots or build output belong in the commit.
- Use `npm run testing` or `Open Testing.cmd` for the desktop testing profile, which seeds from a read-only backup. Use `npm run testing -- --browser` at `http://127.0.0.1:4174/` for the separate conversation-review profile. Revert this batch on the testing branch and rebuild to roll back. Older code ignores the optional preference.

### Controls and verification

| Area | Automated checks and remaining observations |
| --- | --- |
| Tasks, habits and steps | Open a task, switch to a habit, collapse with Escape, verify focus and reopen. Toggle a subtask, add a step, add/rename/delete a nested step, edit/save/cancel, complete and reopen an item. Verify creation from New task and Add habit and rejection of an empty task. |
| Other task sources | Open a pinned quest, open/cancel its editor, unpin it, edit a standalone quest action, dismiss it and check its source record. Toggle a project subtask and open/close the project task editor. |
| Recovery and persistence | Remove, Undo, remove again, unmount and rehydrate the persisted UI store. Verify Tomorrow still has the task. Restore the item through List options and verify its original order. |
| Organization and progress | Move a task via the grip’s arrow key, select a quantity checkpoint, assign a system, filter by system, skip/unskip, inspect whole-day progress, and close List options with Escape. Increment/decrement a continuous counter, toggle today’s session pip and open/close activity history. |
| Navigation and shared controls | In the full app, visit each visible navigation destination and return using Milestone. Toggle themes, activate Reload tasks, open/close Manage spaces and Settings, and open/close reminders and data settings. The reload event is asserted with a simulated animation API. |
| Visual, motion and devices | The conversation panel timed out on the loopback preview even though the testing server reported listening. An independent local HTTP request returned EACCES. Both desktop launch modes built the app but yielded no fresh desktop capture. Thus live appearance in either theme, touch and pointer drag, actual focus trapping/tab traversal and perceived motion remain unverified. The comparison images are design mockups. |
| Remaining interaction coverage | A live pass should include the category selector, all options inside the create/edit drawers, onboarding examples and archive/space-management changes. Existing domain tests and jsdom results do not establish physical-device behavior. |

Historical validation for the preceding implementation and the standalone design study appears in earlier sections. This batch remains testing-only and awaits visual review. The three remote workflows for Pages, relay and desktop release accept manual dispatch only. Local Git metadata remains at `c218de8`. Source publication uses the testing branch with an expected-head check.

Validation in the shared checkout:

- `npm run testing -- --browser` built the TypeScript/Vite testing bundle and reported a listening server on 4174. `npm run testing` and `npm run testing -- --attached` completed the build and ran the isolated desktop launcher. `npm run testing -- --build-only` rebuilt the final bundle.
- `npm test -- --maxWorkers=6 --reporter=dot` passed 541 cases across 52 files before the final nested-step/session journey was added. The final targeted run, `npm test -- src/pages/Today.test.tsx src/pages/Today.navigation.test.tsx --maxWorkers=2 --reporter=dot`, passed all 12 cases. jsdom reported its unimplemented scrollTo API. Native dialog open/close and the reload glyph animation were simulated in DOM tests.
- `node node_modules/eslint/bin/eslint.js src/pages/Today.tsx src/components/today/TaskRow.tsx src/pages/Today.test.tsx src/pages/Today.navigation.test.tsx src/uiStore.ts` passed. A cold all-route test initially timed out while loading lazy routes. The test now waits for route modules and checks the destination shell. A rapid-switch test exposed an exiting row still advertising itself as selected. Exiting rows are now inert and no longer advertise selection.
