# The relay, for free

[docs/relay.md](relay.md) deploys to Fly, which bills a couple of dollars a month
for a machine that never stops. This is the same relay on Oracle Cloud's *Always
Free* tier, which is free in the boring sense: not a trial, not credits that run
out, and no clock running down. The tradeoff is that you assemble it yourself
rather than handing `fly deploy` a `fly.toml`.

Everything here is in `deploy/oracle/`. What you end up with is what Fly would
have given you — an always-on HTTPS address, live push, and the relay's own copy
of the app for your phone to install from.

## Why not the free tiers that sleep

Render, Koyeb and friends will run this image for nothing, and it *works*: every
device keeps a poll going underneath the event stream precisely so a route that
goes quiet is survivable. But a sleeping container has no open streams to write
to, so "the other screen updates as you type" becomes "within thirty seconds,
once something wakes it" — and the first request after a sleep, the one carrying
your edit, pays the cold start. Oracle's free tier doesn't stop, which is the
whole reason to prefer it.

## What you need

- An Oracle Cloud account. A card is required to verify identity; the Always
  Free shapes cannot be charged to it.
- **Prefer the ARM shape** (`VM.Standard.A1.Flex`, 4 OCPU / 24GB across your
  tenancy — 2 OCPU / 12GB is more than enough here). The x86 `E2.1.Micro` is also
  always-free but has 1GB of RAM, which `vite build` will exhaust; `setup.sh`
  adds swap when it sees that, so it works, just slowly. ARM capacity is often
  scarce in busy regions — if the console says "out of capacity", try again later
  or pick another availability domain.
- A free hostname from [duckdns.org](https://www.duckdns.org) (sign in, pick a
  subdomain, copy the token). Caddy needs a name to get a certificate for; bring
  your own domain instead if you have one.

## Once, on the VM

Create the instance with an **Ubuntu** image, add your SSH key, and note the
public IP. Then, in the Oracle console, open the ports — this is the step that
cannot be scripted:

> **Networking → Virtual Cloud Networks → your VCN → Security Lists → Default**
> → *Add Ingress Rules*, twice:
> Source `0.0.0.0/0`, IP Protocol `TCP`, Destination Port `80`, then again `443`.

Then SSH in and run the bootstrap:

```bash
ssh ubuntu@<your-vm-ip>

curl -fsSL https://raw.githubusercontent.com/hvo7/Milestone/main/deploy/oracle/setup.sh -o setup.sh
RELAY_HOST=milestone-you.duckdns.org \
DUCKDNS_SUB=milestone-you \
DUCKDNS_TOKEN=<your duckdns token> \
MILESTONE_TOKEN=<your relay key> \
bash setup.sh
```

It installs Docker, opens the VM's *own* firewall, points the DuckDNS name at
the machine, builds the image and starts the relay behind Caddy. It finishes by
waiting for `https://<host>/api/health` to answer, so it tells you it worked
rather than leaving you to check.

Re-running it is safe — every step looks for its own result first.

### The two things that go wrong

**The ports still don't answer.** Oracle's Ubuntu image carries an `iptables`
INPUT chain that REJECTs everything except SSH, *on top of* the security list you
just edited in the console. Opening one and not the other is the classic failure,
and nothing logs it. `setup.sh` handles the VM half; the console half is yours.

**Caddy can't get a certificate.** Almost always DNS: the name has to resolve to
this machine before Let's Encrypt will issue for it.

```bash
curl -s ifconfig.me          # what the VM thinks it is
dig +short milestone-you.duckdns.org   # what the world thinks
docker compose logs caddy | tail -40
```

## Pointing the devices at it

Exactly as in [relay.md](relay.md) — the address is just yours rather than
Fly's. On each desktop: Sync & Backup → *When you're away* → paste
`https://milestone-you.duckdns.org` and the key → **Save and check**. On the
phone, either paste the same two things into the installed app, or open
`https://milestone-you.duckdns.org/?t=<key>` once and add *that* to your home
screen.

## Keeping it current

There is no `relay.yml` equivalent here: nothing redeploys this VM for you, so
the copy of the app it serves is whatever was current when you last built. That
only matters if your phone installed *from* the relay. Either install the phone
from GitHub Pages instead — which updates itself — or update the VM when you cut
a release:

```bash
ssh ubuntu@<your-vm-ip>
cd ~/Milestone && git pull && cd deploy/oracle && docker compose up -d --build
```

The device documents and the certificates live in named volumes, so a rebuild
keeps both.
