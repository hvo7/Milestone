# The relay: setting one up

Milestone syncs between devices with no account and no service in the middle.
That works perfectly for two computers sharing a cloud folder, and not at all for
a phone — a browser cannot read your OneDrive folder, so the only route it had
was the Wi-Fi bridge, which needs you to be standing next to an *awake* desktop.

The relay is the fix: one small always-on address that all three devices can
reach. It stores one opaque document per device and hands them back. It never
merges anything and has no idea what a task is — every decision about whose
version wins still happens on your devices, in `src/lib/cloudSync.ts`. That is
deliberate, and it is the security argument as much as the simplicity one: the
relay holds your data, but it cannot quietly decide what your data *is*.

It also serves the app itself, so the phone installs Milestone from the relay and
gets every new build from it too.

Fly bills a couple of dollars a month for a machine that never stops. For the
same relay at no cost, on Oracle Cloud's Always Free tier, see
**[relay-oracle.md](relay-oracle.md)** — more assembly, no bill.

## Once, on Fly.io

```bash
fly launch --no-deploy                              # claims the app name from fly.toml
fly volumes create milestone_data --size 1          # so a redeploy keeps the documents
fly secrets set MILESTONE_TOKEN="$(openssl rand -base64 24)"
fly deploy
```

Then read the key back — you will need it on each device:

```bash
fly ssh console -C 'printenv MILESTONE_TOKEN'
```

Check it answers:

```bash
curl https://<your-app>.fly.dev/api/health
# {"ok":true,"app":"milestone","relay":true}
```

Edit `primary_region` in `fly.toml` to somewhere near you before the first
deploy. `auto_stop_machines` is off on purpose — a stopped machine has no open
event streams to push changes down, which turns live sync back into polling.

### Keeping it current

`.github/workflows/relay.yml` redeploys the relay on every push to `main`, so
the copy of the app it serves never falls behind the one on GitHub Pages. It does
nothing until you give it a token:

```bash
fly tokens create deploy -x 999999h
gh secret set FLY_API_TOKEN                          # paste it in
```

## Pointing the devices at it

**On each desktop:** Sync & Backup → *When you're away* → paste the address and
the key, then Save. The card tests it immediately, so a typo is caught while you
are looking at it rather than by never syncing.

**On the phone:** open `https://<your-app>.fly.dev/?t=<the key>` once, then add
it to your home screen. The key is taken out of the address bar and remembered,
so the home-screen shortcut works without it — and because the app was *served*
by the relay, it syncs through it with nothing further to configure.

That is the whole setup. From then on every device holds an event stream open and
changes arrive as they happen, whichever device made them and whatever network
they are on.

## Somewhere other than Fly

The `Dockerfile` is host-agnostic — Render, Railway, Koyeb, a Raspberry Pi or any
box with Docker will run it:

```bash
docker build -t milestone-relay .
docker run -d --restart unless-stopped \
  -p 8787:8787 -v milestone-data:/data \
  -e MILESTONE_TOKEN=your-key milestone-relay
```

Two requirements, whatever you choose:

- **HTTPS.** The hosted app on GitHub Pages is served over HTTPS and a page
  loaded over HTTPS cannot talk to a plain-HTTP address — the browser blocks it
  as mixed content, silently. Every managed host gives you a certificate; on your
  own hardware use a Cloudflare Tunnel or Tailscale rather than forwarding a port.
- **Don't let it sleep.** Free tiers that stop an idle container will still work,
  because every device keeps a poll running underneath the event stream as a
  backstop — but "live" becomes "within thirty seconds, once something wakes it".

Without `MILESTONE_TOKEN` the relay refuses to start. An open relay is your whole
profile, readable by anyone who finds the address.
