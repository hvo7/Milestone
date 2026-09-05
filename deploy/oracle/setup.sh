#!/usr/bin/env bash
#
# Bootstraps the Milestone relay on a fresh Oracle Cloud "Always Free" VM.
#
# Run it on the VM, not on your computer:
#
#   RELAY_HOST=milestone-you.duckdns.org \
#   DUCKDNS_SUB=milestone-you \
#   DUCKDNS_TOKEN=<from duckdns.org> \
#   MILESTONE_TOKEN=<your relay key> \
#   bash setup.sh
#
# Safe to run again: every step checks for its own result first, so a re-run
# after a failure picks up where it stopped rather than starting over.
set -euo pipefail

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

: "${RELAY_HOST:?RELAY_HOST is required, e.g. milestone-you.duckdns.org}"
: "${MILESTONE_TOKEN:?MILESTONE_TOKEN is required — the shared key your devices use}"
DUCKDNS_SUB="${DUCKDNS_SUB:-}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"
REPO="${REPO:-https://github.com/hvo7/Milestone.git}"
DIR="${DIR:-$HOME/Milestone}"

# ── Swap ──────────────────────────────────────────────────────────────────────
# The image build runs `vite build`, which is the memory-hungriest thing that
# will ever happen here. On the 1GB x86 micro shape that is enough to get the
# Node process OOM-killed, and the failure looks like a hung build rather than
# an out-of-memory. The ARM shape has plenty; this only fires on the small one.
TOTAL_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$TOTAL_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  say "Only ${TOTAL_MB}MB of RAM — adding 2G of swap so the build can finish"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ── Docker ────────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  NEEDS_RELOGIN=1
fi
sudo systemctl enable --now docker

# ── The firewall ──────────────────────────────────────────────────────────────
# Oracle's Ubuntu image ships an INPUT chain that REJECTs everything except SSH.
# This is the step people miss: the VCN security list is opened in the console,
# the ports still don't answer, and there is nothing in any log to say why.
say "Opening 80 and 443 on the VM's own firewall"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save 2>/dev/null || true
fi
# ufw is not enabled on Oracle's image by default, but if you turned it on it
# will quietly override the above.
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
fi

# ── DuckDNS ───────────────────────────────────────────────────────────────────
# A free hostname pointed at this VM, so Caddy has something to get a
# certificate for. Skipped if you brought your own domain.
if [ -n "$DUCKDNS_SUB" ] && [ -n "$DUCKDNS_TOKEN" ]; then
  say "Pointing $DUCKDNS_SUB.duckdns.org at this machine"
  mkdir -p "$HOME/duckdns"
  cat > "$HOME/duckdns/update.sh" <<INNER
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=$DUCKDNS_SUB&token=$DUCKDNS_TOKEN&ip=" -o "$HOME/duckdns/last.txt"
INNER
  chmod 700 "$HOME/duckdns/update.sh"
  "$HOME/duckdns/update.sh"
  grep -q 'OK' "$HOME/duckdns/last.txt" || die "DuckDNS refused the update — check the subdomain and token."
  # Oracle hands out a static public IP, so this is belt-and-braces rather than
  # load-bearing; it costs one request every five minutes.
  ( crontab -l 2>/dev/null | grep -v 'duckdns/update.sh'; echo "*/5 * * * * $HOME/duckdns/update.sh >/dev/null 2>&1" ) | crontab -
fi

# ── The app ───────────────────────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  say "Updating the checkout"
  git -C "$DIR" pull --ff-only
else
  say "Cloning Milestone"
  git clone --depth 1 "$REPO" "$DIR"
fi

say "Writing deploy/oracle/.env"
cat > "$DIR/deploy/oracle/.env" <<INNER
RELAY_HOST=$RELAY_HOST
MILESTONE_TOKEN=$MILESTONE_TOKEN
INNER
chmod 600 "$DIR/deploy/oracle/.env"

say "Building and starting — the first build takes a few minutes"
cd "$DIR/deploy/oracle"
# The group membership added by `usermod` above only takes effect on a new
# login, so in this shell the socket is still root-only. Asking Docker rather
# than assuming also covers a re-run in a shell that has since logged back in.
if docker info >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi
$DOCKER compose up -d --build

say "Waiting for HTTPS (Let's Encrypt usually answers within a minute)"
for i in $(seq 1 40); do
  if curl -fsS "https://$RELAY_HOST/api/health" 2>/dev/null | grep -q '"app":"milestone"'; then
    printf '\n\033[32mThe relay is up at https://%s\033[0m\n' "$RELAY_HOST"
    printf 'Put that address and your key into Sync & Backup on every device.\n'
    exit 0
  fi
  sleep 5
done

printf '\n\033[33mIt is not answering on HTTPS yet.\033[0m\n'
printf 'Check, in this order:\n'
printf '  1. %s resolves to this VM:  curl -s ifconfig.me; dig +short %s\n' "$RELAY_HOST" "$RELAY_HOST"
printf '  2. The VCN security list allows 80 and 443 (Oracle console — the script cannot do this)\n'
printf '  3. Caddy'"'"'s view of the certificate:  %s compose logs caddy | tail -40\n' "$DOCKER"
exit 1
