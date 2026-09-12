# Questline workspace

Quests and Systems use the same left-side questline navigation. Questlines remain independent; they are not nested in categories.

- Quests opens one questline's quests and preparation steps. Supporting systems link directly to the corresponding Systems view.
- Systems offers All systems, each questline's linked practices, and General for systems without a questline. A system linked to individual quests appears under those quests' parent questlines too. Legacy single-goal and single-system links remain readable.
- General on Quests holds standalone tasks, errands, commitments, and maintenance. Its Completed history section retains past tasks. General on Systems holds unlinked routines and systems.
- Habit controls use the same records and operations as Today: check-off, counters, session days, skips, nested steps, and undo. Spotlight membership is independent of goal or system links.
- Today's page and global styles remain unchanged, including the small spotlight side box and existing responsive layout.

## Existing data

There is no bulk conversion, reclassification, or reseeding. Storage keys, profile name, IDs, recurrence anchors, and relationships are unchanged. Existing quests retain their checklist-based completion rules. Old `/questline/:id` bookmarks open the new workspace.

New finite quests default to explicit achievement: completing preparation does not mark the outcome achieved. In the quest editor, users can choose separate confirmation or checklist completion. Opting an existing completed quest into separate confirmation preserves its completed state and historical task credit.

Archived General tasks are no longer deleted automatically after 14 days. Saved tasks retain their full history, including hidden and archived records. Explicit deletion and undo remain available; aging out history is limited to records of tasks that were already deleted.

## Validation

`npm test` includes navigation relationship tests and persisted-store preservation, achievement, and undo tests. `npm run build` checks TypeScript and builds the app.

The built UI can be checked with `node_modules/electron/dist/electron.exe scripts/smoke-workspace.cjs` on Windows. This uses `show: false` and a fresh temporary profile, seeds only synthetic data, and never loads the installed Milestone profile. Set `MILESTONE_TEST_OUTPUT` to a directory for screenshots and `result.json`. Assertions cover non-mutating navigation, legacy/quest-only system links, General history, shared Today completion, undo, weekly sessions, achievement, old routes, unchanged Today geometry, and 390px layouts.
