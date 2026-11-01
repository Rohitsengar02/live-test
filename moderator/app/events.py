"""Moderation event bus on Valkey/Redis: pub/sub for live dashboards + capped log."""
from __future__ import annotations

import json
import os
import time
import uuid

import redis.asyncio as redis

REDIS_URL = os.getenv("REDIS_URL", "redis://valkey:6379")
CHANNEL = "mod:events"
LOG_KEY = "mod:events:log"

_r: redis.Redis | None = None


def r() -> redis.Redis:
    global _r
    if _r is None:
        _r = redis.from_url(REDIS_URL, decode_responses=True)
    return _r


async def publish_event(**fields) -> dict:
    ev = {"id": uuid.uuid4().hex[:12], "ts": int(time.time() * 1000), "origin": "automod", **fields}
    data = json.dumps(ev)
    try:
        pipe = r().pipeline()
        pipe.lpush(LOG_KEY, data)
        pipe.ltrim(LOG_KEY, 0, 299)
        pipe.publish(CHANNEL, data)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — never let logging break moderation
        pass
    return ev
