"""System status for the admin command centre: containers, workers, pipeline.

Design constraint that shapes this whole module: **the API container cannot see
Docker.** There is no socket mount, and adding one would give the web tier root
on the host. So container state is inferred from what each service *does* — a
worker that claimed a job 20 seconds ago is up, whichever way Docker labels it —
and anything genuinely unobservable is reported as ``unknown``, never guessed.

An "unknown" that is honest is worth more than a green dot that is assumed.

Self-check: ``python -m app.services.system_status`` (run from app/backend).
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AssistantInsight,
    Extraction,
    Job,
    PipelineRun,
    Post,
    PriorityResult,
    SentimentResult,
    Topic,
)

SIDECAR_URL = os.environ.get("ANALYSIS_SIDECAR_URL", "http://172.22.0.1:8101")
LOKI_URL = os.environ.get("LOKI_URL", "http://loki:3100")
PROM_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")

# A worker that has not touched the queue in this long is not "idle" any more.
# The worker's own idle backoff ramps to 30s, so 3 minutes is ~6 missed cycles:
# late enough to be real, early enough to matter.
WORKER_STALE_S = 180


# ---------------------------------------------------------------------------
# pure helpers (self-checked)
# ---------------------------------------------------------------------------
def worker_state(
    age_s: float | None, pending: int, running: int, stale_s: float = WORKER_STALE_S
) -> tuple[str, str]:
    """Worker liveness, judged against whether there is anything to do.

    The trap this exists to avoid: the worker only stamps ``locked_at`` when it
    CLAIMS a job. With an empty queue it can be perfectly healthy for hours and
    still look silent — reading that as "down" fires a false alarm on every
    quiet night.

    So silence is only a failure when work is waiting:
      - jobs pending/running and no recent claim  -> down (work is stuck)
      - nothing queued                            -> idle (expected)
      - recent claim                              -> ok
    """
    backlog = pending + running
    if age_s is not None and age_s <= stale_s:
        return "ok", "Picked up a job recently."
    if backlog == 0:
        return "idle", "The work queue is empty, so there is nothing to pick up."
    if age_s is None:
        return "down", f"{backlog} job(s) waiting, and the worker has never picked one up."
    if age_s <= stale_s * 4:
        return "warn", f"{backlog} job(s) waiting; the last pickup was {int(age_s)} seconds ago."
    return "down", f"{backlog} job(s) waiting; the last pickup was {int(age_s)} seconds ago."


def health_from_age(age_s: float | None, warn_s: float, fail_s: float) -> str:
    """Map "how long since this last did something" onto a state.

    ``None`` means never observed — that is ``unknown``, not ``down``: a
    pipeline that has never run and a pipeline that died look identical in a
    row count, and calling both "down" cries wolf on a fresh install.
    """
    if age_s is None:
        return "unknown"
    if age_s <= warn_s:
        return "ok"
    if age_s <= fail_s:
        return "warn"
    return "down"


def worst(states: list[str]) -> str:
    """Aggregate child states into a parent state, worst-wins.

    ``idle`` is a healthy state (a worker with an empty queue), so it ranks
    alongside ``ok``. ``unknown`` ranks below ``warn`` but above ``ok``: not
    knowing is worth surfacing, but it must not outrank a confirmed failure.
    """
    order = ["ok", "idle", "unknown", "warn", "down"]
    rank = -1
    for s in states:
        if s in order:
            rank = max(rank, order.index(s))
    return order[rank] if rank >= 0 else "unknown"


def age_seconds(ts: datetime | None, now: datetime | None = None) -> float | None:
    if ts is None:
        return None
    now = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0.0, (now - ts).total_seconds())


def success_rate(done: int, failed: int) -> float | None:
    """None when nothing ran — 0.0 would read as "everything failed"."""
    total = done + failed
    return (done / total) if total else None


# ---------------------------------------------------------------------------
async def _probe(url: str, timeout: float = 2.0) -> dict[str, Any]:
    """Probe a service. Unreachable is a fact we report, never an exception we
    let escape — one dead sidecar must not 500 the whole command centre."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(url)
            body: Any = None
            try:
                body = r.json()
            except Exception:  # noqa: BLE001
                body = (r.text or "")[:200]
            return {"reachable": r.status_code < 500, "status_code": r.status_code, "body": body}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "status_code": None, "error": type(e).__name__, "body": None}


async def build_status(session: AsyncSession) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)

    # --- job queue -------------------------------------------------------
    queue_rows = (
        await session.execute(
            select(Job.kind, Job.status, func.count()).group_by(Job.kind, Job.status)
        )
    ).all()
    queue: dict[str, dict[str, int]] = {}
    for kind, status, count in queue_rows:
        k = kind.value if hasattr(kind, "value") else str(kind)
        s = status.value if hasattr(status, "value") else str(status)
        queue.setdefault(k, {})[s] = count
    pending = sum(v.get("pending", 0) for v in queue.values())
    running = sum(v.get("running", 0) for v in queue.values())
    dead = sum(v.get("dead", 0) for v in queue.values())

    # --- worker liveness: inferred from queue activity, not from Docker ---
    last_lock = await session.scalar(select(func.max(Job.locked_at)))
    last_run_any = await session.scalar(select(func.max(PipelineRun.started_at)))
    heartbeat = max([t for t in (last_lock, last_run_any) if t is not None], default=None)
    worker_age = age_seconds(heartbeat, now)
    wstate, wreason = worker_state(worker_age, pending, running)

    # --- pipeline stages -------------------------------------------------
    stages = []
    stage_defs = [
        ("ingest", "Collecting", "Brings in new forum topics and posts", 6 * 3600, 26 * 3600),
        ("analyze", "Understanding", "Judges each post's urgency and tone, and spots the names in it", 6 * 3600, 26 * 3600),
        ("assistant", "Summarising", "Writes the daily insight summaries overnight", 26 * 3600, 3 * 24 * 3600),
    ]
    for key, label, desc, warn_s, fail_s in stage_defs:
        last = (
            await session.execute(
                select(PipelineRun)
                .where(PipelineRun.kind == key)
                .order_by(PipelineRun.started_at.desc().nullslast(), PipelineRun.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        done_24 = await session.scalar(
            select(func.count()).select_from(PipelineRun).where(
                PipelineRun.kind == key, PipelineRun.status == "done",
                PipelineRun.started_at >= day_ago,
            )
        ) or 0
        failed_24 = await session.scalar(
            select(func.count()).select_from(PipelineRun).where(
                PipelineRun.kind == key, PipelineRun.status == "failed",
                PipelineRun.started_at >= day_ago,
            )
        ) or 0
        total_done = await session.scalar(
            select(func.count()).select_from(PipelineRun).where(
                PipelineRun.kind == key, PipelineRun.status == "done"
            )
        ) or 0
        total_failed = await session.scalar(
            select(func.count()).select_from(PipelineRun).where(
                PipelineRun.kind == key, PipelineRun.status == "failed"
            )
        ) or 0
        age = age_seconds(last.started_at if last else None, now)
        status_val = (
            last.status.value if last is not None and hasattr(last.status, "value")
            else (str(last.status) if last is not None else None)
        )
        state = health_from_age(age, warn_s, fail_s)
        if status_val == "failed" and age is not None and age < warn_s:
            state = "warn"
        stages.append({
            "key": key, "label": label, "description": desc,
            "state": state,
            "last_status": status_val,
            "last_started_at": last.started_at if last else None,
            "last_finished_at": last.finished_at if last else None,
            "last_error": last.error if last else None,
            "last_stats": (last.stats if last else None) or {},
            "age_seconds": age,
            "runs_24h": {"done": done_24, "failed": failed_24},
            "success_rate_24h": success_rate(done_24, failed_24),
            "success_rate_all": success_rate(total_done, total_failed),
            "queue": queue.get(key if key != "assistant" else "assistant_cycle", {}),
        })

    # --- services --------------------------------------------------------
    sidecar = await _probe(f"{SIDECAR_URL}/health")
    if not sidecar["reachable"]:
        # The sidecar is socket-activated with a 15-min idle timer: first
        # contact after a sleep is refused while systemd spawns it. One retry
        # (the probe itself wakes it) separates "asleep by design, waking" from
        # "actually broken" — the same honesty rule as the worker's idle state.
        await asyncio.sleep(4)
        sidecar = await _probe(f"{SIDECAR_URL}/health", timeout=6.0)
    sidecar_body = sidecar.get("body") if isinstance(sidecar.get("body"), dict) else {}
    loki = await _probe(f"{LOKI_URL}/ready")
    prom = await _probe(f"{PROM_URL}/-/healthy")

    db_ok = True
    try:
        await session.execute(select(1))
    except Exception:  # noqa: BLE001
        db_ok = False

    services = [
        {
            "key": "db", "label": "The library",
            "role": "Keeps every post, every score and every insight, ready when you ask",
            "state": "ok" if db_ok else "down",
            "detail": {"container": "app-db-1", "address": "172.22.0.5:5432"},
        },
        {
            "key": "backend", "label": "The messenger",
            "role": "Carries questions from your screen and answers back with live data",
            # This code is running inside it; it is up by construction.
            "state": "ok",
            "detail": {"container": "app-backend-1", "address": "172.22.0.3:8000"},
        },
        {
            "key": "worker", "label": "The workhorse",
            "role": "Collects new posts, scores them and builds the summaries, around the clock",
            "state": wstate,
            "detail": {
                "container": "app-worker-1", "address": "172.22.0.4",
                "last_activity": heartbeat,
                "age_seconds": worker_age,
                "reason": wreason,
                "note": "The workhorse only reports in when it picks up a job. "
                        "With nothing to do, quiet is normal, not a fault.",
            },
        },
        {
            "key": "sidecar", "label": "The analyst",
            "role": "The AI brain: reads each post and judges its urgency, tone and the names in it",
            "state": "ok" if (sidecar_body.get("laya") and sidecar_body.get("gliner"))
                     else ("warn" if sidecar["reachable"] else "down"),
            "detail": {
                "container": "systemd --user comindash-sidecar.service (NOT a container)",
                "address": SIDECAR_URL,
                "models": {
                    "laya": sidecar_body.get("laya"),
                    "gliner": sidecar_body.get("gliner"),
                },
                "note": "Runs on the main machine so it can use the graphics card directly. "
                        "It sleeps when idle and wakes on the next job.",
            },
        },
        {
            "key": "loki", "label": "The diary",
            "role": "Keeps every log line, so anything that happened can be looked up later",
            "state": "ok" if loki["reachable"] else "warn",
            "detail": {
                "container": "app-loki-1", "address": LOKI_URL,
                "note": (
                    "The diary is up but on the wrong internal network, so the "
                    "backend cannot reach it. Nothing is lost: logs still land in "
                    "local files and this page reads those instead."
                ) if not loki["reachable"] else "",
            },
        },
        {
            "key": "prometheus", "label": "The pulse",
            "role": "Counts requests and errors over time, so trends are visible",
            "state": "ok" if prom["reachable"] else "down",
            "detail": {"container": "app-prometheus-1", "address": PROM_URL},
        },
    ]

    # --- data volume -----------------------------------------------------
    counts = {
        "posts": await session.scalar(select(func.count()).select_from(Post)) or 0,
        "topics": await session.scalar(select(func.count()).select_from(Topic)) or 0,
        "priority_results": await session.scalar(select(func.count()).select_from(PriorityResult)) or 0,
        "sentiment_results": await session.scalar(select(func.count()).select_from(SentimentResult)) or 0,
        "extractions": await session.scalar(select(func.count()).select_from(Extraction)) or 0,
        "insights": await session.scalar(select(func.count()).select_from(AssistantInsight)) or 0,
    }
    counts["posts_24h"] = await session.scalar(
        select(func.count()).select_from(Post).where(Post.created_at >= day_ago)
    ) or 0

    overall = worst([s["state"] for s in services] + [s["state"] for s in stages])

    return {
        "generated_at": now,
        "overall": overall,
        "services": services,
        "stages": stages,
        "queue": {
            "by_kind": queue,
            "pending": pending, "running": running, "dead": dead,
            "worker_state": wstate,
            "worker_reason": wreason,
            "worker_last_activity": heartbeat,
        },
        "counts": counts,
    }


# ---------------------------------------------------------------------------
def _self_check() -> None:
    # never-seen is unknown, not down — a fresh install must not look broken
    assert health_from_age(None, 10, 20) == "unknown"
    assert health_from_age(5, 10, 20) == "ok"
    assert health_from_age(10, 10, 20) == "ok"
    assert health_from_age(15, 10, 20) == "warn"
    assert health_from_age(20, 10, 20) == "warn"
    assert health_from_age(21, 10, 20) == "down"

    # An IDLE worker with an empty queue must never read as down — this is the
    # normal overnight state and the reason health_from_age alone is wrong here.
    assert worker_state(99999, 0, 0, 180)[0] == "idle"
    assert worker_state(None, 0, 0, 180)[0] == "idle"
    assert worker_state(10, 0, 0, 180)[0] == "ok"
    assert worker_state(10, 5, 0, 180)[0] == "ok"
    # ...but silence WITH a backlog is a real stall
    assert worker_state(400, 5, 0, 180)[0] == "warn"
    assert worker_state(5000, 5, 0, 180)[0] == "down"
    assert worker_state(None, 3, 0, 180)[0] == "down"
    assert worker_state(5000, 0, 2, 180)[0] == "down"  # running counts as backlog
    assert worker_state(5000, 5, 0, 180)[1]  # a non-ok state always explains itself

    # worst-wins; idle is healthy; a confirmed failure outranks not-knowing
    assert worst(["ok", "ok"]) == "ok"
    assert worst(["ok", "idle"]) == "idle"
    assert worst(["idle", "unknown"]) == "unknown"
    assert worst(["ok", "unknown"]) == "unknown"
    assert worst(["unknown", "warn"]) == "warn"
    assert worst(["warn", "down"]) == "down"
    assert worst(["down", "unknown"]) == "down"
    assert worst([]) == "unknown"
    assert worst(["nonsense"]) == "unknown"

    now = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
    assert age_seconds(None) is None
    assert age_seconds(now - timedelta(seconds=90), now) == 90
    # naive timestamps are treated as UTC rather than exploding
    assert age_seconds(datetime(2026, 9, 28, 11, 59), now) == 60
    # a clock skew into the future clamps to 0, never negative
    assert age_seconds(now + timedelta(seconds=30), now) == 0.0

    assert success_rate(0, 0) is None
    assert success_rate(9, 1) == 0.9
    assert success_rate(0, 5) == 0.0

    print("system_status self-check OK")


if __name__ == "__main__":
    _self_check()
