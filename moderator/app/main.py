"""StreamGuard moderation service (FastAPI).

POST /moderate/text   {"text": "..."}          → text verdict (cached in Valkey)
POST /moderate/image  multipart file=<image>   → NudeNet verdict
GET  /health                                   → model + bot status
Background: AutoMod bot joins every active LiveKit room.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile
from pydantic import BaseModel

from .bot import BotManager
from .events import r
from .text_mod import get_model, moderate_text
from .video_mod import classify, detector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
manager = BotManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # warm both models so the first request is fast
    await asyncio.to_thread(get_model)
    await asyncio.to_thread(detector)
    task = asyncio.create_task(manager.run()) if os.getenv("ENABLE_BOT", "1") == "1" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="StreamGuard Moderator", lifespan=lifespan)


class TextIn(BaseModel):
    text: str
    block_links: bool = True


@app.post("/moderate/text")
async def text_endpoint(body: TextIn):
    t0 = time.perf_counter()
    key = "modcache:text:" + hashlib.sha1(f"{body.block_links}|{body.text}".encode()).hexdigest()
    try:
        cached = await r().get(key)
    except Exception:  # noqa: BLE001
        cached = None
    if cached:
        res = json.loads(cached)
        res["cached"] = True
    else:
        res = await asyncio.to_thread(moderate_text, body.text, body.block_links)
        res["cached"] = False
        try:
            await r().set(key, json.dumps(res), ex=86400)
        except Exception:  # noqa: BLE001
            pass
    res["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return res


@app.post("/moderate/image")
async def image_endpoint(file: UploadFile = File(...)):
    t0 = time.perf_counter()
    data = await file.read()
    res = await asyncio.to_thread(classify, data)
    res["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return res


@app.get("/health")
async def health():
    return {
        "ok": True,
        "text_model": "toxic-bert" if get_model().ready else "wordlist-only",
        "video_model": "nudenet-320n",
        "bot_rooms": manager.status,
    }
