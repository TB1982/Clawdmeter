#!/usr/bin/env python3
"""Tests for the 401-streak token renewal nudge (macOS daemon).

The daemon still never mints a credential — test_freeride.py guards that. What
these cover is the layer above it: after N consecutive 401s the daemon runs a
Claude Code command, checks whether the *stored* token actually changed, and
retries the poll with it. The change-detection is the contract, since which
command triggers a refresh isn't knowable from here.

Run: python -m pytest daemon/tests/test_token_renew.py -x -q
"""
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

import daemon.claude_usage_daemon as mod


# --- config parsing ---------------------------------------------------------

def test_renew_defaults_to_on_with_no_config(tmp_path):
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"):
        p = mod.read_renew_setting()
    assert p == mod.RenewPolicy(True, 3, 900.0)


def test_renew_off_is_honored(tmp_path):
    cfg = tmp_path / "config"
    cfg.write_text("clock = auto\ntoken_renew = off\n")
    with patch.object(mod, "CONFIG_FILE", cfg):
        assert mod.read_renew_setting().enabled is False


def test_renew_thresholds_are_read(tmp_path):
    cfg = tmp_path / "config"
    cfg.write_text("token_renew_after = 5\ntoken_renew_cooldown = 60\n")
    with patch.object(mod, "CONFIG_FILE", cfg):
        p = mod.read_renew_setting()
    assert (p.after, p.cooldown) == (5, 60.0)


def test_garbage_thresholds_fall_back_to_defaults(tmp_path):
    cfg = tmp_path / "config"
    cfg.write_text("token_renew_after = soon\ntoken_renew_cooldown = later\n")
    with patch.object(mod, "CONFIG_FILE", cfg):
        p = mod.read_renew_setting()
    assert (p.after, p.cooldown) == (3, 900.0)


# --- streak / cooldown gating ----------------------------------------------

def _renewer_with_stub_nudge(new_token="NEW"):
    r = mod.TokenRenewer()
    r._nudge = MagicMock(return_value=new_token)
    return r


def test_first_401s_do_not_nudge(tmp_path):
    """Two failures are a blip; only the third is worth spending a turn on."""
    r = _renewer_with_stub_nudge()
    d = Path("/fake/.claude")
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"):
        assert asyncio.run(r.on_expired(d)) is None
        assert asyncio.run(r.on_expired(d)) is None
        assert r._nudge.call_count == 0
        assert asyncio.run(r.on_expired(d)) == "NEW"
    assert r._nudge.call_count == 1


def test_cooldown_suppresses_a_second_nudge(tmp_path):
    """A dead login 401s forever; it must not spawn a CLI turn every minute."""
    r = _renewer_with_stub_nudge(new_token=None)
    d = Path("/fake/.claude")
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"):
        for _ in range(10):
            asyncio.run(r.on_expired(d))
    assert r._nudge.call_count == 1


def test_success_resets_the_streak(tmp_path):
    r = _renewer_with_stub_nudge()
    d = Path("/fake/.claude")
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"):
        asyncio.run(r.on_expired(d))
        asyncio.run(r.on_expired(d))
        r.note_ok(d)
        assert asyncio.run(r.on_expired(d)) is None   # streak restarted at 1
    assert r._nudge.call_count == 0


def test_off_never_nudges(tmp_path):
    cfg = tmp_path / "config"
    cfg.write_text("token_renew = off\n")
    r = _renewer_with_stub_nudge()
    d = Path("/fake/.claude")
    with patch.object(mod, "CONFIG_FILE", cfg):
        for _ in range(5):
            assert asyncio.run(r.on_expired(d)) is None
    assert r._nudge.call_count == 0


# --- the nudge itself -------------------------------------------------------

def test_nudge_without_a_cli_is_a_clean_no_op():
    r = mod.TokenRenewer()
    with patch.object(mod, "_claude_binary", return_value=None):
        assert r._nudge(Path("/fake/.claude"), 3) is None


def test_nudge_stops_at_the_first_command_that_moves_the_token():
    """`auth status` is free and `-p` costs a turn, so a win on the cheap one
    must not fall through to the expensive one."""
    r = mod.TokenRenewer()
    tokens = iter(["OLD", "NEW"])          # before, then after command #1
    ran = []
    with patch.object(mod, "_claude_binary", return_value="/bin/claude"), \
         patch.object(mod, "read_token_for", side_effect=lambda d: next(tokens)), \
         patch.object(mod, "_run_renew", side_effect=lambda cmd, d: ran.append(cmd) or 0):
        assert r._nudge(Path("/fake/.claude"), 3) == "NEW"
    assert len(ran) == 1
    assert ran[0][1:] == ["auth", "status"]


def test_nudge_escalates_then_gives_up_when_the_token_never_changes():
    r = mod.TokenRenewer()
    ran = []
    with patch.object(mod, "_claude_binary", return_value="/bin/claude"), \
         patch.object(mod, "read_token_for", return_value="OLD"), \
         patch.object(mod, "_run_renew", side_effect=lambda cmd, d: ran.append(cmd) or 0):
        assert r._nudge(Path("/fake/.claude"), 3) is None
    assert len(ran) == 2
    assert ran[1][1] == "-p"              # the escalation is a real CLI turn
    assert "login" not in " ".join(ran[1])  # never a browser prompt from a daemon


def test_renew_commands_never_include_auth_login():
    for cmd in mod._renew_commands("/bin/claude"):
        assert cmd[1:3] != ["auth", "login"]


# --- integration with the poll ---------------------------------------------

def test_poll_retries_once_with_the_renewed_token(tmp_path):
    """401 → nudge → the poll runs again with the new token, same cycle, and the
    device gets real numbers instead of a no-data beat."""
    d = Path("/fake/.claude")
    seen = []

    async def fake_poll(token):
        seen.append(token)
        if token == "OLD":
            raise mod.TokenExpired()
        return {"s": 7, "ok": True}

    renewer = _renewer_with_stub_nudge("NEW")
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"), \
         patch.object(mod, "read_config_dirs", return_value=[d]), \
         patch.object(mod, "read_token_for", return_value="OLD"), \
         patch.object(mod, "poll_api", new=fake_poll), \
         patch.object(mod, "_RENEWER", renewer):
        renewer.streak[d] = 2             # already two failures deep
        payload, dead = asyncio.run(mod.poll_active(mod.PlanSelector()))

    assert seen == ["OLD", "NEW"]
    assert dead is False
    assert payload == {"s": 7, "ok": True}


def test_poll_signals_no_data_when_the_nudge_fails(tmp_path):
    d = Path("/fake/.claude")

    async def fake_poll(token):
        raise mod.TokenExpired()

    renewer = _renewer_with_stub_nudge(None)
    with patch.object(mod, "CONFIG_FILE", tmp_path / "absent"), \
         patch.object(mod, "read_config_dirs", return_value=[d]), \
         patch.object(mod, "read_token_for", return_value="OLD"), \
         patch.object(mod, "poll_api", new=fake_poll), \
         patch.object(mod, "_RENEWER", renewer):
        payload, dead = asyncio.run(mod.poll_active(mod.PlanSelector()))

    assert payload is None
    assert dead is True                   # → the device shows "No data", as before
