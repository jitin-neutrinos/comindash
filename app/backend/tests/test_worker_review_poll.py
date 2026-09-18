"""Worker wiring for the ``review_poll`` job kind.

``run_review_poll`` (app/services/aihub/review.py) already did the real work —
polling stored AI Hub result ids for a review verdict — but nothing scheduled
it and the worker had no handler for it, so it never ran. This covers the
wiring: worker.py isn't a package (it's the container's entrypoint script), so
it's imported directly off disk the same way a real worker process would find
it, via BACKEND_PATH-equivalent sys.path setup already done by conftest.

The dispatch test monkeypatches ``run_review_poll`` itself rather than calling
it for real: the worker's ``_invoke`` fills an unset ``session`` parameter
with its default (``None``), and the real function then opens a session from
the module-level engine — which is the actual dev/prod database, not the
sqlite fixture. That is correct behaviour for the real worker process; calling
the handler directly from a test would otherwise write rows into the live DB.
Real behaviour (skip/aihub/corrected paths) is covered against an explicit
sqlite session in test_review_poll.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[2] / "worker"
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import worker as worker_module  # noqa: E402  (path set up above)
import app.services.aihub.review as review_module  # noqa: E402


def test_review_poll_handler_registered():
    assert "review_poll" in worker_module.HANDLERS
    assert worker_module.HANDLERS["review_poll"] is worker_module.handle_review_poll


async def test_review_poll_handler_dispatches_to_run_review_poll(monkeypatch):
    calls = []

    async def fake_run_review_poll(session=None, run_id=None):
        calls.append((session, run_id))
        return {"stage": "review", "mode": "fake"}

    monkeypatch.setattr(review_module, "run_review_poll", fake_run_review_poll)

    result = await worker_module.handle_review_poll(job_id=1, payload={})

    assert calls == [(None, None)]
    assert result == {"stats": {"stage": "review", "mode": "fake"}}
