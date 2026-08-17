"""Dry-run dispatcher: route an OpenSwarm cloud run onto a VM we already have.

Prints the SSM / SSH commands it would run. It does not SSH into anything and
does not open inbound ports. Live deploy stays a human step until SSM is
confirmed from this operator account.

Usage:
    python3 infra/openswarm-cloud/dispatch.py --dry-run --spec spec.json
    python3 infra/openswarm-cloud/dispatch.py --dry-run --spec spec.json --target win2025-vm
    python3 infra/openswarm-cloud/dispatch.py --list
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from machines import (
    DESTROY_GRACE_SECONDS,
    GLOBAL_CAP,
    REGION,
    TICK_BUDGET,
    MACHINES,
    RoutingError,
    get_machine,
    select_machine,
)
from run_spec import InvalidRunSpec, parse_run_spec, report_sequence


def _role_for_spec(needs_browser: bool, requested_role: str | None) -> str:
    if requested_role:
        return requested_role
    # Official Electron runner is linux/amd64. We do not have such a box in
    # inventory, so auto falls through to the Windows worker rather than
    # silently picking the ARM API host.
    return "linux_runner" if needs_browser else "windows_worker"


def plan(
    spec_payload: dict | str,
    *,
    target: str | None = None,
    role: str | None = None,
) -> dict:
    spec = parse_run_spec(spec_payload)
    if target:
        hinted = get_machine(target)
        chosen_role = role or hinted.role
        machine = select_machine(chosen_role, name=target)
    else:
        chosen_role = _role_for_spec(spec.needs_browser, role)
        try:
            machine = select_machine(chosen_role)
        except RoutingError:
            if chosen_role == "linux_runner":
                machine = select_machine("windows_worker")
            else:
                raise

    callback_steps = report_sequence(spec.callback)
    kill_after = spec.max_run_seconds + DESTROY_GRACE_SECONDS
    spec_path = "/tmp/openswarm-run-spec.json"

    if machine.os == "windows":
        commands = [
            (
                f"aws ssm send-command --region {REGION} "
                f"--instance-ids {machine.instance_id} "
                f"--document-name AWS-RunPowerShellScript "
                f"--parameters commands=[\"$env:OPENSWARM_RUN_SPEC_FILE='{spec_path}'; "
                f"pwsh -File C:\\\\openswarm\\\\run-once.ps1\"]"
            )
        ]
    else:
        commands = [
            (
                f"aws ssm send-command --region {REGION} "
                f"--instance-ids {machine.instance_id} "
                f"--document-name AWS-RunShellScript "
                f"--parameters commands=["
                f"\"install -d -m 700 /tmp/openswarm-run && "
                f"cat > {spec_path} <<'EOF'\\n<run-spec>\\nEOF && "
                f"OPENSWARM_RUN_SPEC_FILE={spec_path} "
                f"timeout {spec.max_run_seconds} "
                f"docker run --rm --platform linux/amd64 "
                f"-e OPENSWARM_RUN_SPEC_FILE={spec_path} "
                f"-v {spec_path}:{spec_path}:ro "
                f"registry.fly.io/openswarm-runner:latest\"]"
            )
        ]

    commands.append(
        f"# control plane destroys the worker {DESTROY_GRACE_SECONDS}s after "
        f"max_run_seconds ({kill_after}s wall clock from start)"
    )
    if callback_steps:
        commands.append(
            "# callback order (load-bearing): " + " then ".join(callback_steps)
        )

    return {
        "run_id": spec.run_id,
        "machine": {
            "name": machine.name,
            "instance_id": machine.instance_id,
            "arch": machine.arch,
            "os": machine.os,
            "role": machine.role,
            "public_ip": machine.public_ip,
        },
        "needs_browser": spec.needs_browser,
        "max_run_seconds": spec.max_run_seconds,
        "callback_order": callback_steps,
        "caps": {"global": GLOBAL_CAP, "tick_budget": TICK_BUDGET},
        "dry_run": True,
        "commands": commands,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="print inventory")
    parser.add_argument("--spec", help="path to OPENSWARM_RUN_SPEC JSON")
    parser.add_argument("--target", help="machine name or instance id")
    parser.add_argument(
        "--role",
        choices=("api", "windows_worker", "linux_runner"),
        help="override auto role selection",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="print commands; never execute (default)",
    )
    args = parser.parse_args(argv)

    if args.list:
        rows = [
            {
                "name": m.name,
                "instance_id": m.instance_id,
                "arch": m.arch,
                "os": m.os,
                "role": m.role,
            }
            for m in MACHINES
        ]
        json.dump(rows, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not args.spec:
        parser.error("--spec is required unless --list")

    try:
        payload = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        result = plan(payload, target=args.target, role=args.role)
    except (OSError, InvalidRunSpec, RoutingError) as exc:
        print(f"dispatch refused: {exc}", file=sys.stderr)
        return 2

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
