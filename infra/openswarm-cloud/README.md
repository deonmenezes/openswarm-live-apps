# OpenSwarm BYO-VM cloud integration

OpenSwarm's official cloud path (`openswarm-runner` on Fly Firecracker) is one
ephemeral **amd64 Linux** container per workflow. We do not run that control
plane. This directory is the mapping onto the three EC2 instances we already
have, plus a dry-run dispatcher that refuses to pick the wrong box.

Upstream reference: https://github.com/openswarm-ai/openswarm
(`openswarm-runner/README.md`, `openswarm-edge/`).

## Topology

AWS account `390346501728`, region `us-east-1`. No new VMs.

| Name | Instance | Type | Arch | Role |
|---|---|---|---|---|
| `openswarm-api` | `i-0a2fa6d6bfd0bca9d` | t4g.small | arm64 | **API plane.** Estate `:8001` and churn `:8002` behind nginx at https://54-166-194-87.sslip.io. Existing units in `infra/aws/` stay as they are. |
| `win2025-vm` | `i-0f44590a087ac14e9` | t3.small | x86_64 | **Windows worker.** The only in-bounds machine that can run a desktop/worker agent. |
| `openclaw-prod-openclaw` | `i-066ddf85110a49370` | m7i-flex.large | x86_64 | **Out of bounds.** Different product. Dispatch refuses it by default even though it is amd64 Linux. |

### Why `openswarm-api` cannot run `openswarm-runner`

The official image is amd64-only. CastLabs Electron, which is the browser tier
the runner boots under Xvfb, has no linux-arm64 build. A t4g.small would either
fail to start Electron (exit 7) or silently run a different Electron than users
have on their laptops. So the ARM box stays the FastAPI/nginx plane.

We currently have **no in-bounds linux/x86_64 runner host**. Auto-dispatch of a
`needs_browser` run therefore falls through to `win2025-vm` instead of picking
the ARM API box. Add a dedicated amd64 Linux instance later if we want parity
with Fly's Firecracker runner.

## Dispatcher

Dry-run only. It prints the SSM commands it would send; it does not SSH, does
not open inbound ports, and does not pretend a live deploy succeeded.

```sh
python3 infra/openswarm-cloud/dispatch.py --list

python3 infra/openswarm-cloud/dispatch.py --dry-run \
  --spec infra/openswarm-cloud/examples/run-spec.json

python3 infra/openswarm-cloud/dispatch.py --dry-run \
  --spec infra/openswarm-cloud/examples/run-spec.json \
  --target win2025-vm

# These must refuse:
python3 infra/openswarm-cloud/dispatch.py --dry-run \
  --spec infra/openswarm-cloud/examples/run-spec.json \
  --target openclaw-prod-openclaw

python3 infra/openswarm-cloud/dispatch.py --dry-run \
  --spec infra/openswarm-cloud/examples/run-spec.json \
  --target openswarm-api --role linux_runner
```

Caps, sized for two usable boxes: `GLOBAL_CAP=2`, `TICK_BUDGET=1`. A run is
killed at `max_run_seconds`, then the control plane is supposed to destroy the
worker 5 minutes later — the same third wall OpenSwarm's cloud uses when a VM
wedges.

Callback order is load-bearing: **artifacts, then the terminal report.** The
per-run token is refused once the run is closed.

Credentials: `extra` keys are forbidden. A spec carrying `refreshToken` dies
before any machine is touched. The runner never refreshes.

## Windows worker (`win2025-vm`)

`windows/setup-worker.ps1` installs the Cursor agent CLI and starts a named
My Machines worker (`win2025-vm`). That is the self-hosted path: the agent loop
stays in Cursor's cloud, tool calls execute on the VM, no inbound ports.

Before using RDP, lock `win2025-rdp-sg` to the operator IP the same way
`openswarm-api-sg` already restricts SSH. It is currently `0.0.0.0/0`.

```powershell
# on the instance, after copying the script
pwsh -File C:\openswarm\setup-worker.ps1 -WorkerName win2025-vm
```

Pass a personal Cursor API key via `CURSOR_API_KEY`. Do not use a team Admin
key; those cannot start My Machines workers.

## Tests

```sh
python3 -m unittest discover -s infra/openswarm-cloud/tests -v
```
