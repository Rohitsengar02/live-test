"""AutoMod bot: joins every active LiveKit room as a hidden participant,
samples each video track (camera + screen share) ~1 fps, runs NudeNet, and
server-side mutes the track (and kicks repeat offenders).

This is the authoritative check — it can't be bypassed by a modified client.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import numpy as np
from livekit import api, rtc

from .events import publish_event
from .video_mod import classify

log = logging.getLogger("bot")


def _load_env_file():
    for env_path in [".env", "../.env"]:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip('"').strip("'")
                            if k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass


_load_env_file()

LK_URL = os.getenv("LIVEKIT_URL", "ws://livekit:7880")
LK_KEY = os.getenv("LIVEKIT_API_KEY", "devkey")
LK_SECRET = os.getenv("LIVEKIT_API_SECRET", "secret")
BOT_IDENTITY = "automod-bot"
SAMPLE_SECONDS = float(os.getenv("NSFW_SAMPLE_SECONDS", "1.0"))
HITS_TO_MUTE = int(os.getenv("NSFW_HITS_TO_MUTE", "2"))  # consecutive nude frames
KICK_AFTER_STRIKES = int(os.getenv("NSFW_KICK_AFTER_STRIKES", "3"))
WARN_COOLDOWN = 30.0


def http_url() -> str:
    if LK_URL.startswith("wss://"):
        return LK_URL.replace("wss://", "https://")
    if LK_URL.startswith("ws://"):
        return LK_URL.replace("ws://", "http://")
    return LK_URL


def ws_url() -> str:
    if LK_URL.startswith("https://"):
        return LK_URL.replace("https://", "wss://")
    if LK_URL.startswith("http://"):
        return LK_URL.replace("http://", "ws://")
    return LK_URL


def source_name(src) -> str:
    return {
        rtc.TrackSource.SOURCE_CAMERA: "camera",
        rtc.TrackSource.SOURCE_SCREENSHARE: "screen_share",
    }.get(src, "video")


class RoomBot:
    def __init__(self, room_name: str, lk: api.LiveKitAPI):
        self.room_name = room_name
        self.lk = lk
        self.room = rtc.Room()
        self.tasks: dict[str, asyncio.Task] = {}
        self.strikes: dict[str, int] = {}
        self.last_warn: dict[str, float] = {}
        self.closed = asyncio.Event()

    async def run(self) -> None:
        token = (
            api.AccessToken(LK_KEY, LK_SECRET)
            .with_identity(BOT_IDENTITY)
            .with_name("AutoMod")
            .with_grants(
                api.VideoGrants(
                    room_join=True, room=self.room_name, hidden=True,
                    can_publish=False, can_publish_data=False, can_subscribe=True,
                )
            )
            .to_jwt()
        )

        @self.room.on("track_subscribed")
        def _on_track(track: rtc.Track, pub: rtc.RemoteTrackPublication, p: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_VIDEO:
                try:
                    pub.set_video_quality(rtc.VideoQuality.VIDEO_QUALITY_LOW)  # 1 fps @ low res is plenty
                except Exception:  # noqa: BLE001
                    pass
                self.tasks[pub.sid] = asyncio.create_task(self.watch(track, pub, p))

        @self.room.on("track_unsubscribed")
        def _on_unsub(track, pub, p):
            t = self.tasks.pop(pub.sid, None)
            if t:
                t.cancel()

        @self.room.on("participant_disconnected")
        def _on_left(p):
            if not self.room.remote_participants:
                asyncio.create_task(self.stop())

        @self.room.on("disconnected")
        def _on_disc(*_):
            self.closed.set()

        await self.room.connect(ws_url(), token, rtc.RoomOptions(auto_subscribe=True))
        log.info("AutoMod joined room %s", self.room_name)
        await publish_event(type="system", severity="info", room=self.room_name, detail="AutoMod joined room")
        await self.closed.wait()

    async def stop(self) -> None:
        for t in self.tasks.values():
            t.cancel()
        try:
            await self.room.disconnect()
        finally:
            self.closed.set()

    async def watch(self, track: rtc.Track, pub: rtc.RemoteTrackPublication, p: rtc.RemoteParticipant):
        src = source_name(pub.source)
        stream = rtc.VideoStream(track, format=rtc.VideoBufferType.RGBA)
        consecutive = 0
        next_at = 0.0
        try:
            async for ev in stream:
                now = time.monotonic()
                if now < next_at or pub.muted:
                    continue
                next_at = now + SAMPLE_SECONDS
                f = ev.frame
                img = np.frombuffer(f.data, dtype=np.uint8).reshape(f.height, f.width, 4).copy()
                t0 = time.perf_counter()
                res = await asyncio.to_thread(classify, img)
                ms = round((time.perf_counter() - t0) * 1000)

                if res["verdict"] == "nude":
                    consecutive += 1
                    if consecutive >= HITS_TO_MUTE:
                        consecutive = 0
                        await self.enforce(p, pub, src, res, ms)
                else:
                    consecutive = 0
                    if res["verdict"] == "suggestive":
                        key = f"{p.identity}:{src}"
                        if now - self.last_warn.get(key, 0) > WARN_COOLDOWN:
                            self.last_warn[key] = now
                            await publish_event(
                                type="video", severity="warn", room=self.room_name, identity=p.identity,
                                name=p.name, source=src, detail=f"Suggestive content ({res['score']})",
                                labels=[d["class"] for d in res["detections"]], latency_ms=ms,
                            )
        except asyncio.CancelledError:
            pass
        finally:
            await stream.aclose()

    async def enforce(self, p, pub, src, res, ms):
        ident = p.identity
        self.strikes[ident] = self.strikes.get(ident, 0) + 1
        strikes = self.strikes[ident]
        action = "muted"
        try:
            await self.lk.room.mute_published_track(
                api.MuteRoomTrackRequest(room=self.room_name, identity=ident, track_sid=pub.sid, muted=True)
            )
        except Exception as e:  # noqa: BLE001
            log.warning("mute failed: %s", e)
            action = "mute_failed"

        if strikes >= KICK_AFTER_STRIKES:
            try:
                await self.lk.room.remove_participant(
                    api.RoomParticipantIdentity(room=self.room_name, identity=ident)
                )
                action = "kicked"
            except Exception as e:  # noqa: BLE001
                log.warning("kick failed: %s", e)

        msg = {
            "kind": "video_blocked", "identity": ident, "name": p.name, "source": src,
            "action": action, "strikes": strikes, "ts": int(time.time() * 1000),
        }
        try:
            await self.lk.room.send_data(
                api.SendDataRequest(
                    room=self.room_name, data=json.dumps(msg).encode(),
                    kind=api.DataPacket.Kind.RELIABLE, topic="moderation",
                )
            )
        except Exception as e:  # noqa: BLE001
            log.warning("send_data failed: %s", e)

        await publish_event(
            type="video", severity="block", room=self.room_name, identity=ident, name=p.name,
            source=src, action=action, strikes=strikes, latency_ms=ms,
            detail=f"Nudity detected on {src} ({res['score']}) → {action}",
            labels=[d["class"] for d in res["detections"]],
        )


class BotManager:
    """Polls LiveKit for active rooms and keeps one AutoMod bot in each."""

    def __init__(self):
        self.bots: dict[str, tuple[RoomBot, asyncio.Task]] = {}
        self.lk: api.LiveKitAPI | None = None

    async def run(self):
        self.lk = api.LiveKitAPI(http_url(), LK_KEY, LK_SECRET)
        while True:
            try:
                rooms = (await self.lk.room.list_rooms(api.ListRoomsRequest())).rooms
                active = set()
                for r in rooms:
                    parts = (await self.lk.room.list_participants(api.ListParticipantsRequest(room=r.name))).participants
                    humans = [x for x in parts if x.identity != BOT_IDENTITY]
                    if humans:
                        active.add(r.name)
                for name in active - set(self.bots):
                    bot = RoomBot(name, self.lk)
                    task = asyncio.create_task(self._run_bot(bot))
                    self.bots[name] = (bot, task)
                for name in set(self.bots) - active:
                    bot, _ = self.bots[name]
                    await bot.stop()
            except Exception as e:  # noqa: BLE001
                log.warning("room poll failed (is LiveKit up?): %s", e)
            await asyncio.sleep(3)

    async def _run_bot(self, bot: RoomBot):
        try:
            await bot.run()
        except Exception as e:  # noqa: BLE001
            log.warning("bot %s crashed: %s", bot.room_name, e)
        finally:
            self.bots.pop(bot.room_name, None)

    @property
    def status(self) -> list[str]:
        return sorted(self.bots)
