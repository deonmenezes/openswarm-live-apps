import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from dispatch import plan  # noqa: E402
from machines import (  # noqa: E402
    RoutingError,
    can_run_electron_runner,
    get_machine,
    select_machine,
)
from run_spec import (  # noqa: E402
    InvalidRunSpec,
    parse_run_spec,
    report_sequence,
)


def _spec(**overrides):
    payload = {
        "run_id": "cr_test",
        "workflow": {
            "id": "wf_1",
            "title": "Test",
            "model": "opus-5",
            "steps": [{"text": "hello"}],
        },
        "credentials": [
            {"provider": "claude", "auth_type": "api_key", "api_key": "sk-test"}
        ],
        "callback": {
            "url": "https://example.invalid/report",
            "token": "runner-token",
            "artifacts_url": "https://example.invalid/artifacts",
        },
        "max_run_seconds": 1800,
        "needs_browser": True,
    }
    payload.update(overrides)
    return payload


class RoutingTests(unittest.TestCase):
    def test_api_box_is_arm64_and_not_an_electron_runner(self):
        api = get_machine("openswarm-api")
        self.assertEqual(api.arch, "arm64")
        self.assertEqual(api.role, "api")
        self.assertFalse(can_run_electron_runner(api))
        with self.assertRaises(RoutingError) as ctx:
            select_machine("linux_runner", name="openswarm-api")
        self.assertIn("arm64", str(ctx.exception))

    def test_win2025_is_the_windows_worker(self):
        machine = select_machine("windows_worker")
        self.assertEqual(machine.name, "win2025-vm")
        self.assertEqual(machine.os, "windows")

    def test_openclaw_is_refused_by_name(self):
        with self.assertRaises(RoutingError) as ctx:
            select_machine("linux_runner", name="openclaw-prod-openclaw")
        self.assertIn("out of bounds", str(ctx.exception))

    def test_openclaw_is_refused_by_instance_id(self):
        with self.assertRaises(RoutingError):
            select_machine("api", name="i-066ddf85110a49370")

    def test_unknown_name_fails_closed(self):
        with self.assertRaises(RoutingError) as ctx:
            get_machine("not-a-box")
        self.assertIn("unknown machine", str(ctx.exception))

    def test_no_in_bounds_linux_amd64_runner(self):
        with self.assertRaises(RoutingError) as ctx:
            select_machine("linux_runner")
        self.assertIn("t4g.small", str(ctx.exception))

    def test_role_mismatch_is_refused(self):
        with self.assertRaises(RoutingError):
            select_machine("api", name="win2025-vm")


class RunSpecTests(unittest.TestCase):
    def test_valid_spec_parses(self):
        spec = parse_run_spec(_spec())
        self.assertEqual(spec.run_id, "cr_test")
        self.assertTrue(spec.needs_browser)

    def test_refresh_token_is_forbidden(self):
        payload = _spec()
        payload["credentials"][0]["refreshToken"] = "should-not-travel"
        with self.assertRaises(InvalidRunSpec) as ctx:
            parse_run_spec(payload)
        self.assertIn("refresh", str(ctx.exception).lower())

    def test_mcp_notes_are_names_only(self):
        payload = _spec(
            unavailable_mcp_servers=[{"name": "slack", "url": "http://secret"}]
        )
        with self.assertRaises(InvalidRunSpec):
            parse_run_spec(payload)

    def test_oauth_without_expiry_is_refused(self):
        payload = _spec(
            credentials=[
                {
                    "provider": "claude",
                    "auth_type": "oauth",
                    "access_token": "tok",
                }
            ]
        )
        with self.assertRaises(InvalidRunSpec):
            parse_run_spec(payload)

    def test_expired_oauth_is_refused(self):
        expired = (
            datetime.now(timezone.utc) - timedelta(minutes=5)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload = _spec(
            credentials=[
                {
                    "provider": "claude",
                    "auth_type": "oauth",
                    "access_token": "tok",
                    "expires_at": expired,
                }
            ]
        )
        with self.assertRaises(InvalidRunSpec):
            parse_run_spec(payload)

    def test_unknown_top_level_field_is_refused(self):
        payload = _spec()
        payload["refresh_token"] = "nope"
        with self.assertRaises(InvalidRunSpec):
            parse_run_spec(payload)


class CallbackTests(unittest.TestCase):
    def test_artifacts_before_terminal_report(self):
        spec = parse_run_spec(_spec())
        self.assertEqual(report_sequence(spec.callback), ["artifacts", "terminal"])

    def test_terminal_only_when_no_artifacts_url(self):
        payload = _spec(
            callback={"url": "https://example.invalid/report", "token": "t"}
        )
        spec = parse_run_spec(payload)
        self.assertEqual(report_sequence(spec.callback), ["terminal"])

    def test_empty_when_no_callback(self):
        payload = _spec()
        del payload["callback"]
        spec = parse_run_spec(payload)
        self.assertEqual(report_sequence(spec.callback), [])


class DispatchTests(unittest.TestCase):
    def test_auto_needs_browser_falls_through_to_windows(self):
        result = plan(_spec())
        self.assertEqual(result["machine"]["name"], "win2025-vm")
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["callback_order"], ["artifacts", "terminal"])

    def test_explicit_openclaw_target_is_refused(self):
        with self.assertRaises(RoutingError):
            plan(_spec(), target="openclaw-prod-openclaw")

    def test_api_box_cannot_be_forced_as_linux_runner(self):
        with self.assertRaises(RoutingError):
            plan(_spec(), target="openswarm-api", role="linux_runner")

    def test_explicit_windows_target(self):
        result = plan(_spec(), target="win2025-vm")
        self.assertEqual(result["machine"]["instance_id"], "i-0f44590a087ac14e9")
        joined = "\n".join(result["commands"])
        self.assertIn("AWS-RunPowerShellScript", joined)

    def test_example_spec_file_is_valid(self):
        example = HERE / "examples" / "run-spec.json"
        payload = json.loads(example.read_text(encoding="utf-8"))
        result = plan(payload, target="win2025-vm")
        self.assertEqual(result["run_id"], "cr_local_dry_run")


if __name__ == "__main__":
    unittest.main()
