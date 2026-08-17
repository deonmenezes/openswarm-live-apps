# OpenSwarm live apps

Two OpenSwarm-generated apps, deployed publicly. Frontends are static builds on
Vercel; backends run on the `openswarm-api` EC2 instance behind nginx
(https://54-166-194-87.sslip.io).

| App | Public URL | Backend |
|---|---|---|
| `apps/estate-checkout-lab` | https://estate-checkout-lab.vercel.app | `openswarm-api` :8001 (`/estate`) |
| `apps/swarm-checkout-churn` | https://swarm-checkout-lab.vercel.app | `openswarm-api` :8002 (`/churn`) |

## Machines

| Name | Instance | Type | Arch | What it does |
|---|---|---|---|---|
| `openswarm-api` | `i-0a2fa6d6bfd0bca9d` | t4g.small | arm64 | Both app backends under systemd behind nginx — see `infra/aws/`. |
| `win2025-vm` | `i-0f44590a087ac14e9` | t3.small | x86_64 | Windows Server 2025, runs the Cursor worker in `infra/cursor-worker/`. |
| `openclaw-prod-openclaw` | `i-066ddf85110a49370` | m7i-flex.large | x86_64 | A different product. Not ours to touch. |

`win2025-vm` has no inbound rules at all. It is reached with SSM Session
Manager via the `win2025-ssm-profile` instance profile, which replaced an RDP
rule that was open to `0.0.0.0/0`. Session Manager needs no open port, so
there is nothing to scope to an operator IP and nothing for the internet to
scan. It also ships PowerShell 5.1 and not `pwsh`, so scripts target 5.1.

### Why OpenSwarm cloud runs are not wired up

OpenSwarm's cloud path needs two things this account does not have. Its runner
image is amd64-only, because the CastLabs Electron it boots under Xvfb has no
linux-arm64 build — that disqualifies `openswarm-api` on architecture, and the
one amd64 Linux box here belongs to OpenClaw. The image is also published by
the closed `openswarm-cloud` control plane, which we can read and nothing more.

Unblocking it takes an amd64 Linux host plus either a Fly registry token for
`openswarm-runner` or a local `docker build --platform linux/amd64` from the
OpenSwarm repo root. Until one of those exists there is no target to dispatch
to, so `infra/cursor-worker/` is what actually runs agents on our own hardware.

## The tunnels, and why they are retired

`cloudflared` quick tunnels mint a new hostname on every start, and the
OpenSwarm harness reassigns the backend port on every runtime restart, so
nothing about a laptop-hosted backend could be baked into a JS bundle. The
launchd agents in `infra/launchd/` absorbed both: rediscover the port, reopen
the tunnel, publish the hostname into `vercel.json`, redeploy, health-check.
They are no longer loaded — the sites still went down whenever the laptop
slept, which is why the backends moved to EC2. The scripts are kept only as a
record of that shape.

The bundle still calls a relative `/api` for the reason it always did: a
backend move stays a one-file Vercel rewrite, with no rebuild and no CORS.

## Things that only work inside OpenSwarm

`openswarmHost.ts` talks to `localhost:8324` with a token injected into the
preview URL. On a public deployment that address is the *visitor's* machine, so
every host-SDK call fails there by definition. Two consequences are handled in
the code rather than left to break:

- `ChurnPanel`'s diagnose / create-workflow buttons are hidden unless
  `isInsideOpenSwarm()` is true, instead of being shown and always erroring.
- `SwarmCheckoutButton` falls back harness -> local Ollama -> `reviewWithRules()`.
  The first two are both localhost services, so without the third a real visitor
  waits on a spinner forever and the funnel never completes.

## Telemetry

Churn was originally written only to `localStorage`, which meant every visitor's
abandonment stayed in their own browser and the operator saw nothing. Sessions
are now posted to `/api/ingest/collect`, using `navigator.sendBeacon` on exit:
a normal `fetch` started during `pagehide` is routinely cancelled, and the exit
is the single event churn analysis exists to capture.

Captured values are redacted in the browser before they are sent
(`analytics/redact.ts`), so secrets are destroyed at the keystroke rather than
sanitised server-side. `backend/data/store.json` holds the resulting sessions and
is deliberately gitignored: it is real visitor data, including names and emails
typed into the checkout.

## Running an app backend by hand

The bundled Python ships without `pip` or `ensurepip`, so a plain
`python -m venv` aborts midway and leaves a venv that cannot see `fastapi`, while
the `.openswarm_installed` sentinel makes `run.sh` skip repair forever:

```sh
/Applications/OpenSwarm.app/Contents/Resources/python-env/Python.app/Contents/MacOS/python3 \
  -m venv --system-site-packages --without-pip backend/.venv
```

`swarm_debug` is not in site-packages; it lives in the app bundle and writes a
log-mode file next to itself, which fails there. Copy it somewhere writable and
point `PYTHONPATH` at the copy.
