# Sync: how devices agree, and what to do when they don't

Applies from 3.5.0. Earlier builds (3.4.1 and before) are covered under
[Older builds](#older-builds).

## How the copies are reconciled

Every device keeps a full copy. A device's sync document carries its stores and,
for each item in them, a **stamp**: which device last changed it and that
device's count when it published. A device that receives another copy merges it
**item by item** (`src/lib/syncMerge.ts`):

| Situation | Result |
| --- | --- |
| Only one side changed an item since the other last saw it | That side's version |
| Both changed it without seeing each other | Your change beats the daily reset; between two of yours the later wins and the other is saved as a **sync issue** |
| One side deleted it, the other changed it | Kept, with a sync issue offering to delete it |
| One side added it | Added on the other |
| The daily reset touched it on one side, you changed it on the other | Your change |

Items are found generically: any array of objects with ids, nested to any depth
(questlines → quests → actions, habits → steps, Vynues projects → tasks →
subtasks, Life Vitals areas → check-ins), and the heatmap/history logs key by key.

A device stamps its own changes, merges what it reads, applies the result, and
only then publishes. The daily reset is run through `automatic()`
(`src/lib/syncIntent.ts`), so a laptop opened days later cannot outvote changes
made elsewhere with its reset.

### The failure this replaced

Before, a conflict replaced a whole store with whichever copy was written most
recently. A laptop opened after a few days ran its daily reset first, became "the
most recent" copy, kept its stale data and published it, and the phone then took
it — losing everything done on the phone in between. Reproduced in
`src/lib/syncRecovery.test.ts` ("the reported bug").

## Sync health (Settings › Data & connections › Manage data)

- **Status**: All synced · Sending… · *N* to review · Paused · Not syncing · Update needed · Not connected.
- **Issues**: each item that gave way, with the other version one tap away
  (*Use Laptop's* / *Delete it*) or *Keep*. The list syncs, so an issue found on
  one device can be handled on any. A count shows on the Settings button.
- **Devices**: each other device's version, when it last synced (amber after 3
  days), and how many changes it has not received yet.

## When something goes wrong — emergency steps

1. **Pause sync** on the device that looks wrong. Edits keep saving there and are
   stamped, so nothing is lost and they go out when you resume.
2. **Recover items** and pick a copy:
   - *another device's copy* (as last read),
   - a **safety copy** — taken on this device when the app opens and before every
     merge that changed data or recovery action (newest 30 kept, then one a day
     for 21 days; IndexedDB, per device),
   - a **relay copy** — the relay keeps the version each device replaced, at
     most every 30 minutes (every write from builds before item stamps), newest
     48 per device for 14 days.

   The list shows what that copy has that is **not on this device** (ticked) and
   what is **different here** (not ticked). *Bring back selected* adds or restores
   only those, as your newest change, so they reach every device.
3. **Replace with this copy…** restores a copy wholesale, deletions included.
4. **Use this device's data everywhere…** makes this device's data win on every
   device and removes what exists only elsewhere.
5. **Download emergency file**: this device's data, every other device's last
   copy and the issue list in one JSON file. Each `bundle` inside it loads with
   Data › *Load backup*. **Download it** in Recover saves one copy the same way.

Safety copies and conflict handling never send anything off the device; relay
copies need the relay deployed from 3.5.0 or later (older relays answer
404 and the list simply has no relay copies).

## Older builds

A document without stamps comes from 3.4.1 or earlier. Such a device still
settles conflicts by keeping one whole copy, so its document can be stale. An
updated device therefore lets it **add** items and **change** items nobody has
changed by hand on an updated device — but never **delete**, and never undo a
hand-made change. Sync health marks it *Update needed*.

The **first** device to update stamps everything it holds as made by hand (at
the count it last published), so a device still on 3.4.1 can't revert it.

From 3.5.1, a device that updates **after** another already runs 3.5 joins it
instead: it takes the updated devices' data, then re-applies only what it
changed itself since it last published (the daily reset excepted — it runs
again on the new data). Where an updated device changed the same item too, its
own change is kept and the other version becomes a sync issue. Its previous copy
is a safety copy (*Before taking changes from …*). This is what lets a desktop
left off for days come back — even after one session on the old build, which
took the others' counts while keeping its stale copy — and pick up the latest
state from the laptop and phone.

Cost of these rules during the changeover: edits made on a device in the one
session it still runs the old build, to items already changed on an updated
device, are not applied. They are in that device's safety copies and relay
copies and can be brought back with Recover items. Items deleted on one device
before it updated can come back from a device that still has them.

### Recommended update order

1. Publish the release: `release.yml` (desktop and laptop) and the Cloudflare
   deploy (phone app and relay); `pages.yml` for the web copy.
2. Before updating, let the devices you have sync once (open each online; *Sync
   now*), so no device holds edits the others haven't seen.
3. Update them one at a time, opening each online after it updates. A device
   left off (or still on 3.4.1) catches up when it next opens and updates.
4. Check Sync health on each: the new version everywhere, no *Update needed*.

## Storage and compatibility

- Sync bookkeeping (`milestone-sync-meta`) keeps fingerprints of the last stamped
  copy instead of a second full copy, plus the stamps. Upgrading converts the
  3.4.1 copy once.
- Documents gain `items` and `syncProtocol: 2`; the issue list travels as a fifth
  slot, `issues`. Older builds and relays ignore all three.
- Deletions are remembered for 120 days. A device away longer may bring a deleted
  item back; delete it again.
- Rollback: install the previous build. Its sync reads the stores as before and
  ignores the new fields; its whole-copy conflict handling returns with it.
