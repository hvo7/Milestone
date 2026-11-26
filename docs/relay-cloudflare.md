# Cloudflare private sync

## Current deployment

The user approved Cloudflare hosting on 2026-10-18. The app and relay are deployed
at `https://milestone-sync.henryhuyvo74.workers.dev` (version
`6c547b0c-707b-4ad9-9b75-9b2e0598bcfc`). App and health checks return 200;
unauthenticated sync returns 401. Before the pairing secret was set, health
initially reported `configured: false`. The user subsequently added the secret;
live verification now reports `configured: true` and unauthenticated sync still
returns 401. No device data has been uploaded or overwritten by this setup.
The user subsequently approved the v3.3.9 desktop client release.

This is a separate hosting adapter for the existing sync protocol. It does not
read a desktop profile, copy Testing data, provision credentials, or deploy when
built or tested. The desktop stays authoritative for the first pairing requested
by the user. After pairing, edits travel in both directions.

## Keeping the phone on the current version

The iPhone installs Milestone from the Cloudflare address, so it only ever gets
the build that was last deployed *there*. `pages.yml` (GitHub Pages) and
`release.yml` (desktop) do not update it. On 2026-11-23 the Worker was found
still serving 3.3.10 (built 2026-10-19) while the desktops were on 3.4.0.

Deploy all three together for every release:

1. `release.yml` — desktop and laptop update themselves from the GitHub Release.
2. `pages.yml` — the GitHub Pages copy of the web app.
3. `cloudflare.yml` — the phone app and relay. **This is the one the phone uses.**

`cloudflare.yml` needs two repository secrets, added once under Settings ›
Secrets and variables › Actions:

- `CLOUDFLARE_API_TOKEN`: Cloudflare dashboard › My Profile › API Tokens ›
  Create Token › "Edit Cloudflare Workers" template, limited to this account.
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview page.

Without the workflow, the same deploy from a clone on Windows is:

```powershell
npm ci
npm run generate-icons
npm run cloudflare:prepare
npm --prefix deploy/cloudflare ci
npm --prefix deploy/cloudflare run login
npm --prefix deploy/cloudflare run deploy
```

A deploy replaces the app files and the Worker code only. The relay's stored
device documents and the `MILESTONE_TOKEN` secret are untouched, so devices stay
paired. After a deploy, `https://<worker>/version.json` shows the new version;
the phone picks it up the next time the app is opened with a connection (it
shows an update notice, or applies it when the app is next sent to the
background).

Check which devices are current from any device: Settings › Data & connections.
From 3.4.1 each device reports the version it last synced from.

## Prepared components

- `deploy/cloudflare/worker.mjs`: authenticated HTTP snapshot exchange, SQLite
  Durable Object persistence, and hibernating WebSocket notifications.
- `deploy/cloudflare/wrangler.jsonc`: one SQLite Durable Object and static app
  assets. No paid database, custom domain, container, or external service.
- Clients discover WebSocket support through `/api/health`; existing Wi-Fi and
  Node relays retain SSE. Polling remains a fallback, with reconnects on return.
- Authentication is a random private pairing key, not the Cloudflare password.
  The key must be at least 32 characters. No request logging is enabled.

## Verify locally (no account required)

From the repository root:

```powershell
npm --prefix deploy/cloudflare ci
npm run test:cloudflare
npm test
npm run cloudflare:prepare
npm --prefix deploy/cloudflare run check
npm run testing -- --build-only
```

The Cloudflare app bundle is code-only and goes into `.testing/cloudflare-app`.
Only that directory is eligible for asset upload, never its parent or the test
profile. `check` uses `--dry-run` and does not deploy. The local runtime test uses
temporary storage and synthetic keys and verifies recovery after restart.

## Account connection — user interaction required

1. Stay on the Workers **Free** plan. Do not select an upgrade or buy a domain.
2. Run `npm --prefix deploy/cloudflare run login`. The browser asks the account
   owner to approve Wrangler. Review and approve there; do not paste OAuth tokens,
   the account password, or pairing keys into the conversation.
3. Confirm the intended account with `wrangler whoami` in `deploy/cloudflare`.
   If there are several accounts, select the intended account before deployment.
4. Check Workers & Pages for an existing `milestone-sync` Worker. Do not overwrite
   an unrelated Worker. Change `name` in the configuration if necessary.

## Deployment — only after explicit release approval

1. Run the local checks above and approve the app/relay feature batch.
2. Deploy with `npm --prefix deploy/cloudflare run deploy`. The resulting address
   is the real `https://milestone-sync.<account-subdomain>.workers.dev` URL; never
   substitute a guessed hostname. The first deployment refuses private API calls
   until its secret is installed.
3. Generate a random 32-byte pairing key locally. Keep it in the user's password
   manager or another private location, never in a source file, chat, or test seed.
4. In the Worker's Settings → Variables and Secrets, add a **Secret** named
   `MILESTONE_TOKEN` containing that key, and save/deploy the secret change.
   Alternatively run `wrangler secret put MILESTONE_TOKEN` in `deploy/cloudflare`
   and enter it at the private prompt. Never pass the key as a command argument.
5. `/api/health` should report `app: milestone`, `push: websocket`, and
   `configured: true`. A request to `/api/peers` without the key must return 401.
6. Release the approved desktop client changes separately. No test profile is
   included in the desktop build or copied into production.

## Desktop-first pairing

1. Export a desktop backup before making any live sync changes.
2. Use a fresh relay with no existing documents. If the selected Worker already
   holds documents, STOP and inspect which copy is authoritative before connecting
   anything; the normal reconciler can otherwise adopt existing remote data.
3. On the updated desktop, open Settings → Data & connections → Data, backups,
   sync & updates. Under **When you're away**, enter the new relay URL and pairing
   key, then **Save and check**. Wait for a successful exchange. Verify the relay
   contains the desktop snapshot before connecting the phone.
4. Keep the old iPhone shortcut disconnected. Open the **new relay URL** in Safari,
   then Share → Add to Home Screen. Launch that new installed app.
5. Inside the installed app's settings, enter the same relay URL and key under
   **When you're away**, then Save and check. Pairing inside the installed app
   avoids assuming Safari shares storage with a Home Screen installation.
6. Verify the desktop quests appear before editing anything. If the installed app
   was already used on this exact relay origin, stop and explicitly reset that
   mobile profile first; do not merge its old edits into the desktop.
7. Test a disposable desktop edit arriving on the phone, then a phone edit arriving
   on the desktop. Turn off phone Wi-Fi and repeat over cellular. Background and
   reopen the iPhone app to verify catch-up. Only then remove the obsolete shortcut
   and, if desired, its old website data. The desktop backup remains available.

## Free-plan and recovery boundaries

- This is intended for a few personal devices, not an unlimited public service.
  Cloudflare's Free quotas can stop requests until reset; they are not an uptime
  guarantee. Do not enable a paid plan or paid add-ons.
- Local limits: 16 device documents, 8 MB per upload, 32 live sockets, and the
  newest 20 conflict backups. Older conflict backups are automatically pruned;
  current device documents are never pruned. Keep independent desktop backups.
- Authenticated `GET /api/backups` lists recovery copies; authenticated
  `GET /api/backup?name=<name-without-backup-prefix>` retrieves one. Use the token
  header rather than putting credentials in shared URLs.
- From 3.5.0 the relay also keeps **history**: before a device's
  document is replaced, the previous one is kept if that device's last kept copy
  is over 30 minutes old (always, for documents from builds before item stamps).
  Newest 48 per device, none older than 14 days. `GET /api/history` lists them
  (`id`, `deviceId`, `deviceName`, `saved`); `GET /api/history-item?id=` returns
  one. The app's Recover items reads them. `/api/health` reports `history: true`.
- Conflicts are settled item by item in the clients, not here — see
  [sync-recovery.md](sync-recovery.md). The relay only stores and relays documents.
- Safari may suspend background apps. Changes arrive live while connected and
  catch up when the app resumes. No hosted server can force iOS to keep it running.
- Deploy app/relay updates together after future approvals. Merely updating the
  desktop executable does not update the app assets hosted on Cloudflare.

References: [Durable Objects setup](https://developers.cloudflare.com/durable-objects/get-started/),
[WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Free-plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).
