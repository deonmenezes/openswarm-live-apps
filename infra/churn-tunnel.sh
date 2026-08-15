#!/bin/bash
# Keeps the Swarm Checkout (churn) app live at swarm-checkout-lab.vercel.app.
#
# Unlike the Estate app, OpenSwarm is NOT running this backend — its app card
# isn't open, and the runtime only exists while it is. So this script owns the
# backend itself on a fixed port, which also means the port never moves and the
# tunnel target is stable. It then publishes the tunnel hostname into Vercel's
# rewrite, same as the estate agent, and launchd restarts the whole thing if
# either half dies.

set -uo pipefail

BASE="${HOME}/.openswarm/tunnel/churn"
WORKSPACE="${HOME}/Library/Application Support/OpenSwarm/data/outputs_workspace/1829273ecc5246f39675f64f16ee607c"
DEPLOY_DIR="${BASE}/deploy"
LOG="${BASE}/tunnel.log"
CF_LOG="${BASE}/cloudflared.log"
BACKEND_LOG="${BASE}/backend.log"
PORT=59619
SCOPE="deonmenezes-projects"

CLOUDFLARED="/opt/homebrew/bin/cloudflared"
VERCEL="/opt/homebrew/bin/vercel"
CURL="/usr/bin/curl"
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# swarm_debug writes a log-mode file next to its own module, which fails inside
# the read-only app bundle, so point at the writable copy.
export PYTHONPATH="${HOME}/.openswarm/pydeps"
export BACKEND_PORT="$PORT"

mkdir -p "$BASE"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

backend_ok() {
    "$CURL" -s -m 3 "http://127.0.0.1:${PORT}/api/health/check" 2>/dev/null | grep -q "OK"
}

start_backend() {
    if backend_ok; then
        log "backend already listening on ${PORT}"
        return 0
    fi
    log "starting churn backend on ${PORT}"
    (
        cd "$WORKSPACE" || exit 1
        exec ./backend/.venv/bin/python -m uvicorn backend.main:app \
            --host 0.0.0.0 --port "$PORT" >> "$BACKEND_LOG" 2>&1
    ) &
    BACKEND_PID=$!
    for _ in $(seq 1 20); do
        backend_ok && { log "backend up (pid ${BACKEND_PID})"; return 0; }
        sleep 1
    done
    log "ERROR: backend failed to start; see $BACKEND_LOG"
    return 1
}

start_backend || exit 1

rm -f "$CF_LOG"
"$CLOUDFLARED" tunnel --url "http://localhost:${PORT}" --no-autoupdate > "$CF_LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null' EXIT

URL=""
for _ in $(seq 1 30); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$CF_LOG" 2>/dev/null | head -1)
    [ -n "$URL" ] && break
    sleep 2
done
[ -z "$URL" ] && { log "ERROR: cloudflared printed no hostname"; exit 1; }
log "tunnel up at ${URL} -> localhost:${PORT}"

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
    log "redeployed swarm-checkout-lab.vercel.app -> ${URL}"
else
    log "ERROR: vercel deploy failed; public site still on the old tunnel"
fi

# Watch both halves. cloudflared stays alive even when its origin is gone, so the
# backend is health-checked separately; three strikes avoids flapping on a blip.
FAILS=0
while kill -0 $CF_PID 2>/dev/null; do
    sleep 15
    if backend_ok; then
        FAILS=0
    else
        FAILS=$((FAILS + 1))
        log "backend health check failed (${FAILS}/3)"
        if [ "$FAILS" -ge 3 ]; then
            log "backend down; restarting it in place"
            if start_backend; then
                FAILS=0
            else
                log "could not revive backend; exiting for launchd"
                exit 0
            fi
        fi
    fi
done
log "cloudflared exited; launchd will restart this script"
