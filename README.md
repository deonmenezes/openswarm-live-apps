# OpenSwarm live apps

Two OpenSwarm-generated apps, deployed publicly. Frontends are static builds on
Vercel; backends run on the `openswarm-api` EC2 instance behind nginx
(https://54-166-194-87.sslip.io). The laptop and cloudflared tunnels are no
longer in the request path.

Cloud / BYO-VM dispatch for the three EC2 machines we already have lives in
[`infra/openswarm-cloud/`](infra/openswarm-cloud/README.md). `openswarm-api` is
the ARM API plane; `win2025-vm` is the Windows worker; `openclaw-prod-openclaw`
is out of bounds.

| App | Public URL | Backend |
|---|---|---|
| `apps/estate-checkout-lab` | https://estate-checkout-lab.vercel.app | `openswarm-api` :8001 (`/estate`) |
| `apps/swarm-checkout-churn` | https://swarm-checkout-lab.vercel.app | `openswarm-api` :8002 (`/churn`) |

## Why the tunnel URL is not in the bundle

`cloudflared` quick tunnels mint a new hostname on every start, and the OpenSwarm
harness reassigns the backend port on every runtime restart. Baking either into
the JS would mean a rebuild each time one moved. Instead the bundle calls a
relative `/api`, and `vercel.json` rewrites that to the current tunnel — so a
change is a one-file redeploy, with no rebuild and no CORS.

`infra/` holds the two launchd agents that keep this true without a human:
they discover the backend port, open the tunnel, publish the hostname into
`vercel.json`, redeploy, and then health-check the backend so a moved port or a
dead tunnel repairs itself in about 20 seconds.

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
