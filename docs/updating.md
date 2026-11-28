# Updating every device

How a new version of Milestone reaches the desktop, the laptop and the phone,
and how the state they share is kept one step back while it does.

## The short version

1. On any device: **Settings › Data & connections › Manage data › Sync health ›
   Before updating**. When it says *All N devices have the same data*, press
   **Save checkpoint**. If it names a device that has not caught up, open
   Milestone there (online) first.
2. GitHub › Actions › **Release everywhere** › *Run workflow* on `main`. It
   publishes the desktop build, then (only if that worked) the phone app.
3. Let each device update. Each one saves its own checkpoint just before it
   switches; nothing else to do.

If something looks wrong afterwards: Sync health › **Recover items** › the
newest *Checkpoint, …* entry. Bring back what is missing, or *Replace with this
copy…*.

## What a checkpoint is

`saveCheckpoint` in `src/lib/cloudSync.ts`:

1. One last exchange with the other devices (`syncNow`), so the checkpoint holds
   everything this device can reach, not just its own copy.
2. The result is saved three ways:
   - on the device, as a safety copy (IndexedDB, `milestone-sync-safety`),
     listed in Recover items under its reason;
   - in the cloud folder's `backups/` (desktop and laptop), newest 30
     checkpoints kept, other rescue copies untouched;
   - on the relay (`POST /api/backup`), where the relay keeps the newest 20
     backups of any kind.

   Files are named `checkpoint-<time>_v<version>_<device>_<reason>.json` and use
   the Backup & Restore bundle format, so *Data › Load backup* also reads them.
3. It reports whether this device reached the others (`synced`), whether every
   other device already had exactly the same data (`allInSync`, from each
   device's clocks: nothing waiting, nothing unmerged, not on a pre-3.5 build),
   and whether a copy left the device (`shared`). The same content is not
   uploaded twice.

## When devices take one by themselves

`src/lib/updateCheckpoint.ts`, started from `renderApp.tsx`:

| Device | When | Limit |
| --- | --- | --- |
| Desktop / laptop | As soon as an update finishes downloading (it may install on quit with no chance to run anything first) | — |
| Desktop / laptop | **Restart now**: a fresh one, then the restart | waits at most 20 s |
| Phone / web | As soon as it learns of a new build, while it is still in front and online | — |
| Phone / web | Before the reload onto the new build (button, toast, or going to the background) | waits at most 12 s |

An update is never blocked by a checkpoint: offline, the copy stays on the
device and the update goes ahead. Each device also takes a safety copy when it
first opens on the new version, before it syncs.

## Releasing

`.github/workflows/release-all.yml` (**Release everywhere**, manual only):

1. `release.yml`: tests, packages the Windows build, publishes GitHub Release
   `v<version>` with the notes from `CHANGELOG.md`. Skipped if that release
   already exists, so a re-run only redeploys the phone app.
2. `pages.yml`, only if step 1 succeeded: tests, builds, deploys the phone app to
   `https://hvo7.github.io/Milestone/`.

Ordering is deliberate: a failed desktop build never leaves the phone a version
ahead. `release.yml` and `pages.yml` can still be run on their own.

The relay is not part of it. It only needs a deploy when
`deploy/cloudflare/worker.mjs` changes (see `docs/relay-cloudflare.md`);
checkpoints use the backup API every deployed relay already has.

## The first update to a version with checkpoints

A device takes the checkpoint in the version it is leaving, so devices on 3.5.x
do not take one by themselves on the way to 3.6.0. For that one update: open
each device and *Sync now*; on the device that has everything, Sync health ›
Recover items › **Download emergency file**. Each device still takes a safety
copy when it first opens on 3.6.0.

## Render

Milestone no longer uses Render. Its `Dockerfile` and `render.yaml` were removed
from the repository (commit `4f06760`), so a Render service still connected to
the repository fails every deploy with *failed to read dockerfile*. Nothing in
Milestone depends on it: the relay is the Cloudflare Worker at
`milestone-sync.henryhuyvo74.workers.dev`. Delete (or suspend) the service in the
Render dashboard (open the service; *Delete* and *Suspend* are at the bottom of
its Settings), or turn its *Auto-Deploy* off to keep it but stop the failures. Check first that no
device's relay address is an `onrender.com` one (Settings › Data & connections ›
*When you're away*).
