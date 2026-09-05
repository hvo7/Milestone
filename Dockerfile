# The relay, as something you can actually deploy.
#
# server/relay.mjs has been the answer to "my devices are never awake at the same
# time" since 3.0.0, and it was never running anywhere — which is why the phone
# only ever synced while standing next to an open desktop. This image is the
# missing half: the relay plus a build of the app for it to serve, in one
# artefact that any container host will run.
#
# Two stages, because the build needs the whole toolchain and the thing that runs
# needs none of it. The relay itself imports nothing outside node: — the runtime
# stage carries no node_modules at all, which is also the security argument.

# ── Build the app ─────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# Debian rather than Alpine: sharp (which renders the PWA icons below) ships
# prebuilt binaries for glibc, and on musl it falls back to compiling from source
# — a much slower build with far more that can go wrong.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The icons are gitignored so the installed app's mark can never drift from
# public/logo.svg — which means they don't exist until something renders them.
# Without this the phone installs with a blank home-screen icon.
RUN npm run generate-icons
RUN npm run build

# ── Run the relay ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Just the server and the built app. No dependencies, because relay.mjs has none.
COPY --from=build /app/dist ./dist
COPY server/relay.mjs ./server/relay.mjs

# Documents live on a mounted volume, so a redeploy doesn't discard what the
# devices have published. Losing them is survivable — every device regenerates
# its document from current state on the next publish — but it makes a deploy
# look like a sync outage until each device next writes.
ENV MILESTONE_DATA=/data
ENV MILESTONE_DIST=/app/dist
ENV PORT=8787
RUN mkdir -p /data

# MILESTONE_TOKEN is deliberately not set here. It is the only thing standing
# between the internet and your profile, so it belongs in the host's secret
# store (`fly secrets set MILESTONE_TOKEN=…`), never in an image layer. The
# relay refuses to start without one.

EXPOSE 8787

# Left as root on purpose. A mounted volume arrives owned by root, so dropping to
# the `node` user means an entrypoint script that chowns /data before exec'ing —
# a moving part on the startup path, to protect a single-process container that
# holds nothing but the documents it is already serving.

# No init system and no wrapper: one process, and the host restarts it if it
# exits. Exec form so it receives SIGTERM directly and shuts down cleanly.
CMD ["node", "server/relay.mjs"]
