"""OpenSwarm cloud run-spec, trimmed to the fields this dispatcher needs.

Mirrors https://github.com/openswarm-ai/openswarm/blob/main/openswarm-runner/runner/run_spec.py
closely enough that a spec valid here is valid there, without importing the
desktop app. Extra keys are refused so a refresh token cannot sneak in.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

SPEC_ENV = "OPENSWARM_RUN_SPEC"
SPEC_FILE_ENV = "OPENSWARM_RUN_SPEC_FILE"
MIN_TOKEN_LIFETIME = timedelta(minutes=2)
MAX_SKILLS = 60
MAX_SKILL_FILE_CHARS = 200_000
FORBIDDEN_SECRET_KEYS = frozenset(
    {"refreshToken", "refresh_token", "refreshTokenEncrypted"}
)


class InvalidRunSpec(ValueError):
    """The control plane handed us something we refuse to run."""


def _reject_forbidden_keys(payload: Any, path: str = "$") -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in FORBIDDEN_SECRET_KEYS:
                raise InvalidRunSpec(
                    f"{path}.{key} is forbidden: runner credentials must not "
                    "include a refresh token"
                )
            _reject_forbidden_keys(value, f"{path}.{key}")
    elif isinstance(payload, list):
        for index, item in enumerate(payload):
            _reject_forbidden_keys(item, f"{path}[{index}]")


def _require(obj: dict, key: str, path: str) -> Any:
    if key not in obj:
        raise InvalidRunSpec(f"{path} is missing {key!r}")
    return obj[key]


def _as_dict(value: Any, path: str) -> dict:
    if not isinstance(value, dict):
        raise InvalidRunSpec(f"{path} must be an object")
    return value


def _as_list(value: Any, path: str) -> list:
    if not isinstance(value, list):
        raise InvalidRunSpec(f"{path} must be an array")
    return value


def _as_str(value: Any, path: str, *, min_length: int = 1) -> str:
    if not isinstance(value, str) or len(value) < min_length:
        raise InvalidRunSpec(f"{path} must be a non-empty string")
    return value


class ProviderCredential:
    def __init__(self, raw: dict, path: str) -> None:
        extra = set(raw) - {
            "provider",
            "auth_type",
            "label",
            "access_token",
            "api_key",
            "expires_at",
            "scope",
        }
        if extra:
            raise InvalidRunSpec(f"{path} has unknown fields: {sorted(extra)}")
        self.provider = _as_str(_require(raw, "provider", path), f"{path}.provider")
        self.auth_type = _as_str(_require(raw, "auth_type", path), f"{path}.auth_type")
        if self.auth_type not in ("oauth", "api_key"):
            raise InvalidRunSpec(f"{path}.auth_type must be oauth or api_key")
        self.access_token = raw.get("access_token")
        self.api_key = raw.get("api_key")
        self.expires_at = raw.get("expires_at")
        if self.auth_type == "oauth":
            if not self.access_token:
                raise InvalidRunSpec(f"{path} is oauth but carries no access_token")
            if not self.expires_at:
                raise InvalidRunSpec(f"{path} is oauth but carries no expires_at")
            if self.api_key:
                raise InvalidRunSpec(f"{path} carries both an access_token and an api_key")
        else:
            if not self.api_key:
                raise InvalidRunSpec(f"{path} is api_key but carries no api_key")
            if self.access_token:
                raise InvalidRunSpec(f"{path} carries both an access_token and an api_key")

    def remaining_lifetime(self, now: datetime) -> Optional[timedelta]:
        if not self.expires_at:
            return None
        expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        return expires.astimezone(timezone.utc) - now.astimezone(timezone.utc)


class CallbackTarget:
    def __init__(self, raw: dict, path: str) -> None:
        extra = set(raw) - {"url", "token", "heartbeat_seconds", "artifacts_url"}
        if extra:
            raise InvalidRunSpec(f"{path} has unknown fields: {sorted(extra)}")
        self.url = _as_str(_require(raw, "url", path), f"{path}.url")
        self.token = _as_str(_require(raw, "token", path), f"{path}.token")
        heartbeat = raw.get("heartbeat_seconds", 30)
        if not isinstance(heartbeat, int) or not 5 <= heartbeat <= 300:
            raise InvalidRunSpec(f"{path}.heartbeat_seconds must be 5..300")
        self.heartbeat_seconds = heartbeat
        artifacts = raw.get("artifacts_url")
        self.artifacts_url = (
            _as_str(artifacts, f"{path}.artifacts_url") if artifacts else None
        )


class RunSpec:
    def __init__(self, raw: dict) -> None:
        extra = set(raw) - {
            "run_id",
            "workflow",
            "credentials",
            "callback",
            "skills",
            "unavailable_mcp_servers",
            "max_run_seconds",
            "needs_browser",
        }
        if extra:
            raise InvalidRunSpec(f"run spec has unknown fields: {sorted(extra)}")
        self.run_id = _as_str(_require(raw, "run_id", "$"), "$.run_id")
        workflow = _as_dict(_require(raw, "workflow", "$"), "$.workflow")
        self.workflow = {
            "id": _as_str(_require(workflow, "id", "$.workflow"), "$.workflow.id"),
            "title": _as_str(
                _require(workflow, "title", "$.workflow"), "$.workflow.title"
            ),
            "model": workflow.get("model"),
            "steps": _as_list(workflow.get("steps", []), "$.workflow.steps"),
        }
        credentials = _as_list(
            _require(raw, "credentials", "$"), "$.credentials"
        )
        if not credentials:
            raise InvalidRunSpec("$.credentials must contain at least one credential")
        self.credentials = [
            ProviderCredential(_as_dict(item, f"$.credentials[{i}]"), f"$.credentials[{i}]")
            for i, item in enumerate(credentials)
        ]
        callback_raw = raw.get("callback")
        self.callback = (
            CallbackTarget(_as_dict(callback_raw, "$.callback"), "$.callback")
            if callback_raw is not None
            else None
        )
        skills = raw.get("skills", [])
        if not isinstance(skills, list) or len(skills) > MAX_SKILLS:
            raise InvalidRunSpec(f"$.skills must be an array of at most {MAX_SKILLS}")
        for skill in skills:
            skill_obj = _as_dict(skill, "$.skills")
            files = _as_list(skill_obj.get("files", []), "$.skills.files")
            for file in files:
                file_obj = _as_dict(file, "$.skills.files")
                text = file_obj.get("text", "")
                if isinstance(text, str) and len(text) > MAX_SKILL_FILE_CHARS:
                    raise InvalidRunSpec("skill file exceeds MAX_SKILL_FILE_CHARS")
        self.skills = skills
        mcp = raw.get("unavailable_mcp_servers", [])
        for note in _as_list(mcp, "$.unavailable_mcp_servers"):
            note_obj = _as_dict(note, "$.unavailable_mcp_servers")
            extra_note = set(note_obj) - {"name"}
            if extra_note:
                raise InvalidRunSpec(
                    "unavailable_mcp_servers is names only; extra fields "
                    f"{sorted(extra_note)} are refused so secrets cannot travel"
                )
        self.unavailable_mcp_servers = mcp
        max_run = raw.get("max_run_seconds", 1800)
        if not isinstance(max_run, int) or not 60 <= max_run <= 7200:
            raise InvalidRunSpec("$.max_run_seconds must be 60..7200")
        self.max_run_seconds = max_run
        self.needs_browser = bool(raw.get("needs_browser", True))

    def expired_credentials(self, now: datetime) -> list[ProviderCredential]:
        stale: list[ProviderCredential] = []
        for credential in self.credentials:
            remaining = credential.remaining_lifetime(now)
            if remaining is not None and remaining < MIN_TOKEN_LIFETIME:
                stale.append(credential)
        return stale


def parse_run_spec(raw: str | dict) -> RunSpec:
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise InvalidRunSpec(f"run spec is not valid JSON: {exc}") from exc
    else:
        payload = raw
    if not isinstance(payload, dict):
        raise InvalidRunSpec("run spec must be a JSON object")
    _reject_forbidden_keys(payload)
    spec = RunSpec(payload)
    now = datetime.now(timezone.utc)
    stale = spec.expired_credentials(now)
    if stale:
        names = ", ".join(c.provider for c in stale)
        raise InvalidRunSpec(
            f"credential(s) expired or thinner than {MIN_TOKEN_LIFETIME}: {names}"
        )
    return spec


def report_sequence(callback: Optional[CallbackTarget]) -> list[str]:
    """Artifacts must be uploaded before the terminal report.

    The per-run callback token is refused once the run is closed, so reversing
    this order loses files.
    """
    if callback is None:
        return []
    steps: list[str] = []
    if callback.artifacts_url:
        steps.append("artifacts")
    steps.append("terminal")
    return steps
