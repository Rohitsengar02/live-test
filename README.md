# StreamGuard — open-source live streaming with real-time AI moderation

Next.js 16 + self-hosted LiveKit + NudeNet + toxic-bert + Valkey. Live video, screen share,
chat, reactions and moderation — **100% free and open source, nothing calls a paid API.**

| Feature | How it works |
|---|---|
| Live streaming (camera + mic) | Self-hosted **LiveKit** SFU (WebRTC, ~100–300 ms latency), simulcast + adaptive stream |
| Screen share | LiveKit screen share; the stage switches to focus layout automatically |
| Real-time chat | Messages go to the server → moderated → fanned out over LiveKit data channels |
| Chat history / cache | **Valkey** keeps the last 100 messages per room, moderation verdicts, room list cache, rate limits |
| Text moderation | **toxic-bert** (ONNX, CPU) + Hindi/Hinglish/English word filter (catches `f.u.u.c.k`, `sh1t`, Devanagari) + link & phone blocking + rate limiting. Falls back to **obscenity** if the service is down |
| Video moderation — layer 1 | **NudeNet in the browser** (vladmandic/nudenet, TF.js/WebGL) scans the host's own camera + screen 2–3×/s and switches the source off **on-device** |
| Video moderation — layer 2 | **AutoMod bot** (Python, NudeNet ONNX, ~30 ms/frame) joins every room hidden, samples each video track 1×/s, **server-mutes** the track and kicks repeat offenders. Cannot be bypassed by a modified client |
| Moderator dashboard | Live event feed (SSE ← Valkey pub/sub), rooms + participants, mute/kick/chat-ban/delete/clear, test bench for text and images |
| Reactions | Floating emoji, rate limited, real time |

Measured in an end-to-end test: explicit video was muted by AutoMod **0.9 s** after it started; chat moderation took 3–6 ms with the word filter (toxic-bert adds its CPU inference time on top); repeated messages are served from cache.

## Open-source projects used

| Project | Licence | Role |
|---|---|---|
| [livekit/livekit](https://github.com/livekit/livekit) v1.13.11 | Apache-2.0 | WebRTC media server |
| [livekit client / components / server SDKs](https://github.com/livekit) | Apache-2.0 | browser + Node + Python SDKs |
| [vladmandic/nudenet](https://github.com/vladmandic/nudenet) | MIT | in-browser NSFW detection (TF.js) |
| [notAI-tech/NudeNet](https://github.com/notAI-tech/NudeNet) 3.4.2 | MIT | server NSFW detection (ONNX) |
| [Xenova/toxic-bert](https://huggingface.co/Xenova/toxic-bert) (unitary/toxic-bert) | Apache-2.0 | toxicity classifier (6 labels) |
| [obscenity](https://github.com/jo3-l/obscenity) | MIT | fallback profanity filter |
| [valkey-io/valkey](https://github.com/valkey-io/valkey) | BSD-3 | cache + pub/sub |
| [caddyserver/caddy](https://github.com/caddyserver/caddy) | Apache-2.0 | local HTTPS so phones can use the camera |
| TensorFlow.js, onnxruntime, FastAPI, Next.js | Apache-2.0 / MIT | runtimes |

## Quick start (Docker — recommended)

Requires Docker Desktop (Windows/Mac) or Docker Engine (Linux).

```bash
# macOS / Linux
./start.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File start.ps1
```

The script detects your LAN IP, writes `.env`, and builds/starts 5 containers
(first build downloads ~1.5 GB of images and models; later starts take seconds).

Then open:

- **This computer:** `https://localhost`
- **Phone / other laptop on the same Wi-Fi:** `https://<your-LAN-IP>` — tap *Advanced → Proceed* on the certificate warning once (it's a local self-signed cert; browsers only allow camera/mic on HTTPS)
- **Moderator dashboard:** `https://<your-LAN-IP>/moderator` — password `admin123` (change `MOD_PASSWORD` in `.env`)

> **Windows firewall:** allow inbound **443/TCP, 7881/TCP, 7882/UDP** (Docker Desktop usually asks the first time).

## Test checklist (use 2–3 devices)

1. **Laptop:** home page → enter a name → **Go live as host**. Allow camera/mic. The *On-device AI guard* bar loads the model (first time ~70 MB, then cached in IndexedDB).
2. **Phone:** open `https://<LAN-IP>` → the room appears under **Live now** within ~3 s → **Watch**.
3. **Chat:** type on the phone → appears on the laptop instantly. Try:
   - `hello` → delivered
   - `you are a f.u.c.k.i.n.g idiot` → delivered as `*******` (policy `mask`), logged
   - `tu chutiya hai` → masked (Hinglish filter)
   - `join www.spam.xyz` / `call 9876543210` → blocked, sender sees why
   - 6 messages in 5 s → rate limited
   - Refresh the phone → chat history comes back from cache
4. **Screen share:** laptop → *Share screen* → phone switches to focus layout.
5. **Moderator:** open `/moderator` in a third tab → watch events stream in live. Click *Mute camera*, *Mute chat*, *Kick* — the effect shows instantly on the other devices. *Watch hidden* joins the room invisibly with per-message *Delete*.
6. **Video moderation without real nudity:** in the dashboard *Test bench*, upload an image to compare server vs browser NudeNet (boxes drawn on the image). To test the live pipeline, share your screen and open a test image from NudeNet's samples (`github.com/vladmandic/nudenet/tree/main/samples`) — the browser guard turns the share off, and if you disable the guard (checkbox), AutoMod mutes it server-side ~1 s later. Every viewer sees a toast.

## Local development (without Docker)

```bash
# 1. LiveKit server (download the binary from github.com/livekit/livekit/releases)
livekit-server --config livekit/livekit.yaml --node-ip 127.0.0.1 \
  --keys "devkey: secret_change_me_to_32_chars_min_xx"

# 2. Valkey or Redis
docker run -p 6379:6379 valkey/valkey:8-alpine     # or a local redis-server

# 3. Moderation service (Python 3.10+)
cd moderator && pip install -r requirements.txt
LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_SECRET=secret_change_me_to_32_chars_min_xx \
REDIS_URL=redis://127.0.0.1:6379 TEXT_MODEL_DIR=./models/toxic-bert \
uvicorn app.main:app --port 8000

# 4. Web
cd web && cp .env.example .env.local && npm install && npm run dev
```

Open `http://localhost:3000`. (Other devices need HTTPS — use Docker/Caddy for that.)

## Architecture

```
 Browser (host) ──WebRTC──▶ LiveKit SFU ──WebRTC──▶ Browsers (viewers)
   │  NudeNet TF.js (on-device)    │  ▲
   │                               │  │ mute / kick / data packets
   │ POST /api/chat                ▼  │
   └────────▶ Next.js API ──▶ Moderator service (FastAPI)
               │   │              ├─ toxic-bert ONNX + word filter
               │   │              └─ AutoMod bot (hidden participant, NudeNet ONNX)
               │   └──▶ LiveKit sendData → everyone gets approved messages
               └──▶ Valkey: chat history · verdict cache · rate limits · rooms cache · event pub/sub
                                     │
 /moderator dashboard ◀── SSE ───────┘
```

Key security choice: **no participant is allowed to publish data packets** (`canPublishData: false`).
Chat can only reach the room through the server, so it can't skip moderation.
Moderation actions use LiveKit's server API, not client-side tricks.

## Tuning (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `CHAT_POLICY` | `mask` | `mask` delivers profanity as `****`; `block` rejects it |
| `TEXT_TOXIC_THRESHOLD` | `0.70` | toxic-bert score that flags a message |
| `NSFW_MIN_SCORE` | `0.45` | NudeNet detection confidence |
| `NSFW_SAMPLE_SECONDS` | `1.0` | AutoMod sampling interval per video track |
| `NSFW_HITS_TO_MUTE` | `2` | consecutive explicit frames before muting (fewer false positives) |
| `NSFW_KICK_AFTER_STRIKES` | `3` | mutes before the participant is removed |

Word list: `moderator/app/blocked_words.txt` (one per line; restart the moderator container).

## Going to production later

- Put it on a server with a domain → replace `tls internal` in `caddy/Caddyfile` with your domain (real Let's Encrypt cert), set `use_external_ip: true` in `livekit.yaml`.
- Add a TURN server for users behind strict NAT (LiveKit has one built in — `turn:` section).
- Replace the name-only join with real auth (the token API is the single place to change).
- Scale: LiveKit is horizontally scalable with Redis; run more moderator replicas and shard rooms.
- Move NSFW scanning to GPU (`onnxruntime-gpu`) for hundreds of concurrent streams.
- Toxic-bert is English-first; for Hindi script beyond the word list, swap in a multilingual model such as `unitary/multilingual-toxic-xlm-roberta` (export to ONNX).

## Troubleshooting

- **Phone shows "connection failed":** check firewall for 7881/TCP + 7882/UDP and that `LAN_IP` in `.env` is your Wi-Fi IP. `docker compose logs livekit`.
- **Camera blocked on phone:** you must use `https://`, not `http://`.
- **iPhone screen share:** not supported by iOS Safari (viewing works).
- **`text_model: wordlist-only` in health:** toxic-bert failed to download during build; rebuild with internet access: `docker compose build --no-cache moderator`.
- **Guard says "model failed":** the browser has no WebGL; it falls back to CPU (slow). AutoMod still protects the stream.
