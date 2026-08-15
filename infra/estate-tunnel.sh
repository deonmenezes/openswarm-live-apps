#!/bin/bash
# Keeps the Estate Checkout Lab reachable from the public Vercel site.
#
# The backend deliberately stays on this Mac, so a tunnel is the only way in.
# Two things move underneath us and both used to break the public site silently:
#
#   1. OpenSwarm reassigns the backend port on every runtime restart (.env says
#      61305, the harness has handed out 49971), so a hardcoded port goes stale.
#   2. cloudflared quick tunnels mint a NEW hostname every start, so the URL
#      baked into Vercel's rewrite goes stale the moment the tunnel restarts.
#
# So: discover the port, start the tunnel, then push the fresh hostname into
# vercel.json and redeploy. launchd (KeepAlive) reruns this whole script if
# cloudflared ever dies, which makes a tunnel death self-healing rather than an
# outage that needs a human.

set -uo pipefail

HOME_DIR="${HOME}"
BASE="${HOME_DIR}/.openswarm/tunnel"
DEPLOY_DIR="${BASE}/deploy"
LOG="${BASE}/tunnel.log"
CF_LOG="${BASE}/cloudflared.log"
SCOPE="deonmenezes-projects"

CLOUDFLARED="/opt/homebrew/bin/cloudflared"
VERCEL="/opt/homebrew/bin/vercel"
CURL="/usr/bin/curl"
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# The estate backend is identified by its own data, not just by answering a
# health check — OpenSwarm's own services also expose /api/health/check, and
# tunnelling the wrong one would look like success while serving nothing.
find_backend_port() {
    local ports p
    ports=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
        | awk '/[Pp]ython/ {n=split($9,a,":"); print a[n]}' | sort -u)
    for p in $ports; do
        if "$CURL" -s -m 2 "http://127.0.0.1:${p}/api/listings/list" 2>/dev/null | grep -q "sunset-ridge"; then
            echo "$p"
            return 0
        fi
    done
    return 1
}

PORT=""
for _ in $(seq 1 30); do
    PORT=$(find_backend_port) && [ -n "$PORT" ] && break
    log "waiting for the estate backend to come up..."
    sleep 10
done

if [ -z "$PORT" ]; then
    log "ERROR: no estate backend found on any local port. Is OpenSwarm open?"
    exit 1
fi
log "found estate backend on port ${PORT}"

rm -f "$CF_LOG"
"$CLOUDFLARED" tunnel --url "http://localhost:${PORT}" --no-autoupdate > "$CF_LOG" 2>&1 &
CF_PID=$!
# If we exit for any reason, take the tunnel with us so launchd restarts from a
# clean slate instead of leaving an orphan holding the old hostname.
trap 'kill $CF_PID 2>/dev/null' EXIT

URL=""
for _ in $(seq 1 30); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CF_LOG" 2>/dev/null | head -1)
    [ -n "$URL" ] && break
    sleep 2
done

if [ -z "$URL" ]; then
    log "ERROR: cloudflared never printed a hostname; see $CF_LOG"
    exit 1
fi
log "tunnel up at ${URL} -> localhost:${PORT}"

# Point the public site at this hostname. The bundle itself has no URL in it:
# Vercel rewrites /api to the tunnel, so a URL change is a config redeploy and
# never a rebuild.
cat > "${DEPLOY_DIR}/vercel.json" <<JSON
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "${URL}/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
JSON

cd "$DEPLOY_DIR" || exit 1
if "$VERCEL" deploy --prod --yes --scope "$SCOPE" >> "$LOG" 2>&1; then
    log "redeployed estate-checkout-lab.vercel.app -> ${URL}"
else
    log "ERROR: vercel deploy failed; the public site is still on the old tunnel"
fi

# Hold the script open for as long as BOTH the tunnel and the backend behind it
# are alive. cloudflared happily keeps running when its origin dies, so watching
# the process alone is not enough: every OpenSwarm runtime restart moves the
# backend to a new port and would otherwise leave the public site pointed at a
# port nothing is listening on. Exiting here lets launchd restart us, which
# rediscovers the port and redeploys.
FAILS=0
while kill -0 $CF_PID 2>/dev/null; do
    sleep 15
    if "$CURL" -s -m 5 "http://127.0.0.1:${PORT}/api/listings/list" 2>/dev/null | grep -q "sunset-ridge"; then
        FAILS=0
    else
        FAILS=$((FAILS + 1))
        # Three strikes rather than one: the backend is briefly unreachable during
        # a normal OpenSwarm restart, and flapping the tunnel on every blip would
        # churn hostnames (and Vercel deploys) for no reason.
        if [ "$FAILS" -ge 3 ]; then
            log "backend on port ${PORT} stopped answering; exiting so launchd rediscovers it"
            exit 0
        fi
        log "backend health check failed (${FAILS}/3) on port ${PORT}"
    fi
done
log "cloudflared exited; launchd will restart this script"
