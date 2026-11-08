"""register_participant retry (outside demo mode the role needs a grant_role first)."""

import threading
import time

import httpx
import pytest

from perception.app import _startup_stdb
from perception.stdb import StdbClient, StdbRejected

CFG = {"stdb": {"participant_name": "perception"}}


class FakeStdb:
    def __init__(self, rejects: int):
        self.rejects = rejects
        self.registers = 0
        self.identity = "ab" * 32
        self.needs_register = threading.Event()

    def ensure_identity(self):
        return "token"

    def register_participant(self, name, role):
        self.registers += 1
        if self.rejects > 0:
            self.rejects -= 1
            raise StdbRejected("rejected", 530, "role not granted")


def wait_for(cond, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_retries_with_backoff_then_registers_again_on_signal():
    stdb = FakeStdb(rejects=2)
    stop = threading.Event()
    t = threading.Thread(target=_startup_stdb, args=(stdb, CFG, stop), kwargs={"backoff_s": (0.05, 0.1)}, daemon=True)
    t.start()
    try:
        assert wait_for(lambda: stdb.registers == 3)
        time.sleep(0.3)
        assert stdb.registers == 3  # registered: no more attempts
        stdb.needs_register.set()  # a write came back "not registered"
        assert wait_for(lambda: stdb.registers == 4)
    finally:
        stop.set()
        t.join(timeout=3)
    assert not t.is_alive()


def test_backoff_is_not_a_tight_loop():
    stdb = FakeStdb(rejects=10_000)
    stop = threading.Event()
    t = threading.Thread(target=_startup_stdb, args=(stdb, CFG, stop), kwargs={"backoff_s": (0.1,)}, daemon=True)
    t.start()
    time.sleep(0.35)
    stop.set()
    t.join(timeout=3)
    assert stdb.registers <= 5


def _client(status: int, text: str) -> StdbClient:
    transport = httpx.MockTransport(lambda req: httpx.Response(status, text=text))
    return StdbClient("http://stdb.test", "db", token="t", transport=transport, sleep=lambda s: None)


def test_not_registered_rejection_sets_needs_register():
    c = _client(530, "not registered")
    with pytest.raises(StdbRejected):
        c.call("report_breathing", [])
    assert c.needs_register.is_set()


def test_other_rejection_does_not_set_needs_register():
    c = _client(530, "survivor not found")
    with pytest.raises(StdbRejected):
        c.call("report_breathing", [])
    assert not c.needs_register.is_set()
