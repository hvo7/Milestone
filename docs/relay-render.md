# The relay, for free and in five minutes

[relay.md](relay.md) uses Fly, which bills a couple of dollars a month.
[relay-oracle.md](relay-oracle.md) is free forever but asks you to build a VM.
This is the middle one: free, and about five minutes of clicking.

Render builds the repo's `Dockerfile` and gives the result an HTTPS address of
its own, so there is no VM, no domain, no certificate and no firewall — the three
things that make the Oracle route long.

## Setting it up

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, choose the `Milestone` repo. Render reads
   [`render.yaml`](../render.yaml) and proposes a free web service called
   `milestone-relay`, already pointed at the Dockerfile.
3. It asks for **`MILESTONE_TOKEN`** — that is the shared key, and the same
   string goes on every device. Generate one if you don't have it:

   ```powershell
   $b = New-Object byte[] 24
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   [Convert]::ToBase64String($b)
   ```

4. **Apply**. The first build takes a few minutes — it compiles the app as well
   as the server.
5. Check it:

   ```bash
   curl https://milestone-relay.onrender.com/api/health
   # {"ok":true,"app":"milestone","relay":true}
   ```

Then point the devices at that address exactly as in [relay.md](relay.md).

Pushing to `main` redeploys it, so the copy of the app it serves stays current
without a workflow — the thing `.github/workflows/relay.yml` exists to do for Fly.

## The two things the free tier costs you

**It sleeps.** Render stops a free service after about fifteen minutes with no
traffic, and the next request pays a cold start of roughly a minute. In practice
your devices hold an SSE stream open and `EventSource` retries every three
seconds when it drops, so while any device is running there is traffic and it
stays up. When everything is closed it sleeps, and the first sync of the morning
is slow. The poll underneath the event stream is exactly the backstop for this.

**It forgets.** There is no free persistent disk, so a restart empties the
relay's documents. This is survivable *by design* rather than by luck: the relay
only ever holds copies. Every device keeps the real data locally and republishes
as soon as it finds the relay empty —

```ts
if (peers.length === 0) { await publish(false); return; }   // src/lib/cloudSync.ts
```

— so a restart costs one round trip per device. Nothing you typed is at risk,
and no device ever adopts an empty relay as truth.

If either of those bothers you, [relay-oracle.md](relay-oracle.md) has neither
problem and still costs nothing; it just takes longer to build.

## Somewhere else free

The image is host-agnostic, so the same repo deploys to any of these with the
same two decisions — build from `Dockerfile`, set `MILESTONE_TOKEN`:

- **Koyeb** — a free instance that historically does not sleep, which would fix
  the cold start above. Same Dockerfile, no `render.yaml`.
- **Hugging Face Spaces** — free Docker spaces idle out after *48 hours* rather
  than fifteen minutes. Set `app_port` to the relay's port in the Space's README.

Free tiers change often; check the current terms before assuming any of this
still holds.
