# Milestone engineering review — 2026-10-19

## Scope and limits

Release reviewed: 3.3.10, Batch 012. Source-wide inventory and syntax scanning covered 184 authored source/test/style files (29,084 lines) under src, electron, server, scripts, public, and deploy/cloudflare; dependencies and generated bundles were excluded. Type checking, application tests, lint, dependency auditing and integration tests supplement manual review of sync, persistence, import/restore, scheduling, renderer startup, Electron boundaries, release scripts and web update paths. This is a risk-focused engineering review, not a claim that every line received a manual security audit or that the codebase is defect-free.

## Fixed in this release

- An offline peer caused the desktop to repeatedly publish the same snapshot. Its own OneDrive file write then triggered another reconciliation. The watcher now excludes its own snapshot and non-peer files, and the publisher remembers successfully delivered content/clocks for the current connection. Failed delivery remains pending; reconnecting republishes once.
- Idle checks now run every five minutes while push is healthy; disconnected checks run once per minute. Push reconciliation reuses its notification fetch.
- HTTP calls and WebSocket handshakes share a persisted budget per endpoint and client profile: 30 per minute and 8,000 per UTC day. Limits preserve unsent changes. This is not a server/account-wide quota enforcement mechanism: old clients, different profiles, concurrent browser contexts, preflight requests and outside traffic are not fully covered.
- A three-renderer integration test exposed a first-pairing race: initial store bookkeeping was published before applying an existing remote snapshot. Initial reconciliation now avoids promoting that initial state and retains the backup-before-adoption path. The new regression verifies this case.

## Verification

- Final full application suite: 474 tests passed across 42 files, including the additional pairing regression.
- Final focused sync suite: 50 tests; desktop/folder-watcher/real HTTP relay: 9 tests.
- Actual local Cloudflare runtime tests passed: authentication, live notifications, invalid/stale writes, large snapshots, backup retention and persistence across restart.
- Three isolated Electron renderers using synthetic data and the production renderer passed: phone completion reached all clients in 767 ms; desktop undo reached all clients in 776 ms; no reload after edits.
- A simulated day with an offline peer generates zero unchanged uploads. A later edit uploads successfully. A healthy push transport makes at most 290 HTTP requests in the simulated day, plus the separate reconciliation recovery checks.
- Request budgets share HTTP/WebSocket accounting, survive module reload and reset at midnight UTC.
- Preview-isolation checks passed. The Electron helper suites passed 23 tests using Vitest; an initial invocation with Node's test runner was incorrect and was corrected.
- TypeScript/build checks passed. Production archive checks verify the version and watcher code and exclude Testing files.

## Outstanding findings

### High: dependency maintenance needs a dedicated update

The root dependency audit reports 22 affected package entries: 13 high, 8 moderate and 1 low. These are package severity totals, not 22 demonstrated exploits. Electron 36.9.5 is part of the shipped runtime and has advisories; it must not be dismissed just because npm lists Electron under devDependencies. Other affected entries include react-router, Vite, Vitest, sharp and transitive tooling dependencies. Applicability differs: server-only router functionality and build-tool vulnerabilities are not automatically reachable through this client-only app.

Action: update supported Electron and runtime packages first, then development tools; retest Windows packaging, preload isolation, notifications, updater, web caching and sync. Do not apply an unreviewed force-upgrade across major versions during a hotfix.

### High: backup import does not validate the state before replacement

`src/components/DataModal.tsx` accepts any truthy `_milestone` field and any string `quest`/`vynues` values, then writes them into localStorage before parsing their embedded store schemas. Invalid embedded JSON can therefore replace good saved data; a failure on the second write can leave a partial import. The manual import path does not create a fresh recovery snapshot first.

Action: validate every store and supported format version before writing, create a recovery snapshot, and use a staged restore with rollback if persistence fails. Add malformed/partial/quota-failure tests. `src/lib/autoBackup.ts` should share the same validation rather than implement a second restore policy.

### Medium: quality gate is not currently clean

`npm run lint` reports 13 errors and 1 warning in existing UI code: ColorPicker, QuestCreateDrawer, TaskCreateDrawer, VynuesProjectModal, VynuesTaskCreateDrawer and vynuesUi. The reports concern state changes inside effects, refs analysis, mixed component/helper exports and an unused suppression. Some ref reports need human interpretation rather than mechanical fixes. The changed sync files pass targeted lint.

Action: separate editor initialization from effect-driven resets, extract shared non-component exports, review pointer/ref lifecycle, and make the lint command a reliable CI gate. The current ESLint configuration applies its rules to TypeScript/TSX; it does not provide equivalent lint coverage for Electron/server JavaScript.

### Medium: release CI omits important integration suites

`.github/workflows/release.yml` runs `npm test` before packaging but does not run `npm run test:sync`, the Cloudflare runtime suite or the three-client smoke test. This incident passed unit checks until the real renderer test revealed a startup race.

Action: run the Node desktop/relay tests in release CI and a dedicated Cloudflare job. Add the isolated real-renderer smoke test on Windows and retain its result artifacts.

### Medium: quotas remain client safeguards, not an account-wide guarantee

`src/lib/syncBudget.ts` uses localStorage. Separate devices have separate counters, and simultaneous tabs can race on read/increment/write. WebSocket handshakes are counted but legacy SSE automatic reconnects and browser-managed CORS preflights are not controlled by this function. Requests from old installations remain unbounded by the new client.

Action: keep the current conservative budget, ensure devices update, and add cross-tab coordination plus server/account observability if stronger enforcement is required. A Worker handler returning a rate-limit response still consumes a Worker invocation, so handler-level rejection alone cannot guarantee fewer than 100,000 incoming requests.

### Medium: concurrent edits still resolve whole stores

`src/lib/cloudSync.ts` resolves conflicts at quest/vynues/ui store granularity and retains backups. Independent simultaneous changes to different quests in the same store are not merged per item. This is documented behavior, but it is a product limitation to address before advertising collaborative multi-device editing without conflict loss.

### Low: no-op tree updates allocate new arrays

`src/lib/subtree.ts` says mapNode preserves the original array when no node matches, but it always calls map and returns a new array. This defeats the reference-equality optimization described in its contract and can cause unnecessary renders and store notifications. The new upload guard prevents these no-op snapshots from causing extra network writes.

Action: return the original array when every child is unchanged and test reference preservation.

### Low: large modules and stale comments add maintenance cost

The main quest store exceeds 1,000 lines; Today, VynuesPage and TaskRow each exceed 800. Several comments still describe earlier polling or release behavior. Size alone is not a correctness defect, but mixing scheduling, CRUD, nested task mutations and view concerns makes changes harder to isolate.

Action: gradually extract cohesive domain operations and editor subcomponents with behavior-preserving tests. Update release comments that still imply pushes automatically publish, although workflows now require manual dispatch.

## Positive foundations

The code already separates pure scheduling/domain helpers from rendering, uses immutable store updates, preserves legacy storage during migration, isolates Testing profiles, uses Electron context isolation with Node integration disabled, retains conflict backups, bounds Cloudflare payloads and backup counts, uses parameterized SQL, and keeps API responses outside the service-worker cache. These are useful foundations, but the outstanding findings mean the repository should not be described as fully clean or fully audited.
