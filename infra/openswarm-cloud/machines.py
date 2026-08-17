"""Inventory and routing for the EC2 machines we already have.

OpenSwarm's official cloud runner (`openswarm-runner`) is amd64 Linux only —
CastLabs Electron publishes no linux-arm64 build. That is why `openswarm-api`
(t4g.small / arm64) stays the API plane and is never selected for an Electron
runner, and why `openclaw-prod-openclaw` is out of bounds: it is a different
product, even though it happens to be amd64 Linux.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

Role = Literal["api", "windows_worker", "linux_runner", "forbidden"]
Arch = Literal["arm64", "x86_64"]
OSName = Literal["linux", "windows"]


class RoutingError(ValueError):
    """A requested machine or role cannot run this job."""


@dataclass(frozen=True)
class Machine:
    name: str
    instance_id: str
    instance_type: str
    arch: Arch
    os: OSName
    public_ip: str
    role: Role
    key_name: Optional[str]
    security_group: str
    notes: str


ACCOUNT_ID = "390346501728"
REGION = "us-east-1"

# Caps analogous to OpenSwarm cloud's CLOUD_RUNS_GLOBAL_CAP / TICK_BUDGET,
# sized for two usable boxes rather than a Fly fleet.
GLOBAL_CAP = 2
TICK_BUDGET = 1
DESTROY_GRACE_SECONDS = 5 * 60

MACHINES: tuple[Machine, ...] = (
    Machine(
        name="openswarm-api",
        instance_id="i-0a2fa6d6bfd0bca9d",
        instance_type="t4g.small",
        arch="arm64",
        os="linux",
        public_ip="54.166.194.87",
        role="api",
        key_name="openswarm-api",
        security_group="openswarm-api-sg",
        notes=(
            "FastAPI estate:8001 and churn:8002 behind nginx at "
            "https://54-166-194-87.sslip.io. ARM, so it cannot run "
            "openswarm-runner."
        ),
    ),
    Machine(
        name="win2025-vm",
        instance_id="i-0f44590a087ac14e9",
        instance_type="t3.small",
        arch="x86_64",
        os="windows",
        public_ip="3.91.3.190",
        role="windows_worker",
        key_name="win2025-rdp-key",
        security_group="win2025-rdp-sg",
        notes=(
            "Windows Server 2025. Target for the OpenSwarm / Cursor worker. "
            "RDP is currently open to 0.0.0.0/0; lock it to the operator IP."
        ),
    ),
    Machine(
        name="openclaw-prod-openclaw",
        instance_id="i-066ddf85110a49370",
        instance_type="m7i-flex.large",
        arch="x86_64",
        os="linux",
        public_ip="3.227.173.87",
        role="forbidden",
        key_name=None,
        security_group="openclaw-prod-OpenClawSecurityGroup-ZKrF6hxUymQ0",
        notes="OpenClaw production. Out of bounds for OpenSwarm dispatch.",
    ),
)

_BY_NAME = {m.name: m for m in MACHINES}
_BY_ID = {m.instance_id: m for m in MACHINES}


def get_machine(name_or_id: str) -> Machine:
    machine = _BY_NAME.get(name_or_id) or _BY_ID.get(name_or_id)
    if machine is None:
        known = ", ".join(m.name for m in MACHINES)
        raise RoutingError(f"unknown machine {name_or_id!r}; known: {known}")
    return machine


def machines_for_role(role: Role) -> tuple[Machine, ...]:
    return tuple(m for m in MACHINES if m.role == role)


def can_run_electron_runner(machine: Machine) -> bool:
    """Official openswarm-runner image: linux + x86_64, and not forbidden."""
    return (
        machine.role != "forbidden"
        and machine.os == "linux"
        and machine.arch == "x86_64"
    )


def select_machine(role: Role, name: Optional[str] = None) -> Machine:
    """Pick a machine for a job, failing closed on unknown or forbidden targets."""
    if name:
        machine = get_machine(name)
        if machine.role == "forbidden":
            raise RoutingError(
                f"{machine.name} is out of bounds for OpenSwarm "
                f"(role={machine.role}); it belongs to another product"
            )
        if role == "linux_runner" and not can_run_electron_runner(machine):
            raise RoutingError(
                f"{machine.name} cannot run openswarm-runner: "
                f"need linux/x86_64, have {machine.os}/{machine.arch}. "
                f"{machine.notes}"
            )
        if machine.role != role:
            raise RoutingError(
                f"{machine.name} is role {machine.role!r}, not {role!r}"
            )
        return machine

    if role == "linux_runner":
        matches = tuple(
            m
            for m in MACHINES
            if can_run_electron_runner(m) and m.role != "forbidden"
        )
    else:
        matches = machines_for_role(role)
    if not matches:
        if role == "linux_runner":
            raise RoutingError(
                "no linux/x86_64 OpenSwarm runner host in inventory. "
                "openswarm-api is arm64 (t4g.small) and cannot run the "
                "official Electron runner; openclaw-prod-openclaw is amd64 "
                "Linux but is out of bounds. Use win2025-vm (windows_worker) "
                "or add a dedicated amd64 Linux box."
            )
        raise RoutingError(f"no machine in inventory for role {role!r}")
    return matches[0]
