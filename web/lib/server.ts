import 'server-only';
import Redis from 'ioredis';
import { AccessToken, RoomServiceClient, TokenVerifier, DataPacket_Kind, TrackSource } from 'livekit-server-sdk';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

// ---------- env ----------
function toHttpUrl(url: string): string {
  if (url.startsWith('wss://')) return url.replace(/^wss:\/\//, 'https://');
  if (url.startsWith('ws://')) return url.replace(/^ws:\/\//, 'http://');
  return url;
}

export const LK_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
export const LK_SECRET = process.env.LIVEKIT_API_SECRET || 'secret_change_me_to_32_chars_min_xx';
export const LK_URL = toHttpUrl(process.env.LIVEKIT_URL || 'http://localhost:7880');
export const MOD_PASSWORD = process.env.MOD_PASSWORD || 'admin123';
export const MODERATOR_URL = process.env.MODERATOR_URL || 'http://localhost:8000';
export const CHAT_POLICY = (process.env.CHAT_POLICY || 'mask') as 'mask' | 'block';
export const BOT_IDENTITY = 'automod-bot';

export type Role = 'host' | 'viewer' | 'moderator';

// ---------- singletons (survive Next dev hot reloads) ----------
const g = globalThis as unknown as { __redis?: Redis; __rsc?: RoomServiceClient };

export function redis(): Redis {
  if (!g.__redis) {
    g.__redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      lazyConnect: false,
    });
    g.__redis.on('error', (e) => console.warn('[redis]', e.message));
  }
  return g.__redis;
}

/** Each SSE client needs its own connection for SUBSCRIBE. */
export function redisSubscriber(): Redis {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
}

export function rooms(): RoomServiceClient {
  if (!g.__rsc) g.__rsc = new RoomServiceClient(LK_URL, LK_KEY, LK_SECRET);
  return g.__rsc;
}

// ---------- tokens ----------
export async function makeToken(room: string, name: string, role: Role) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'user';
  const identity = `${role === 'moderator' ? 'mod' : role}-${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const at = new AccessToken(LK_KEY, LK_SECRET, {
    identity,
    name,
    ttl: '6h',
    attributes: { role },
    metadata: JSON.stringify({ role }),
  });
  // Nobody may publish raw data packets: every chat message must pass through
  // the server so it can be moderated. The server re-broadcasts approved ones.
  if (role === 'host') {
    at.addGrant({
      room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    });
  } else if (role === 'moderator') {
    at.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, hidden: true, roomAdmin: true });
  } else {
    at.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false });
  }
  return { token: await at.toJwt(), identity };
}

const verifier = new TokenVerifier(LK_KEY, LK_SECRET);

export async function verifyRequest(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'missing token');
  try {
    const claims = await verifier.verify(token);
    const room = claims.video?.room;
    if (!room || !claims.sub) throw new Error('bad claims');
    const role = ((claims.attributes as Record<string, string> | undefined)?.role || 'viewer') as Role;
    return { identity: claims.sub, name: claims.name || claims.sub, room, role };
  } catch {
    throw new HttpError(401, 'invalid token');
  }
}

export function checkModPassword(pw: string | null | undefined) {
  if (pw !== MOD_PASSWORD) throw new HttpError(401, 'wrong moderator password');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: (e as Error).message || 'server error' }, { status: 500 });
    }
  };
}

// ---------- realtime broadcast ----------
const enc = new TextEncoder();
export async function broadcast(room: string, topic: string, payload: unknown) {
  try {
    await rooms().sendData(room, enc.encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, { topic });
    return true;
  } catch (e) {
    // room may be empty/closed — the action itself (DB/cache change) still succeeded
    console.warn(`[broadcast] ${room}/${topic}: ${(e as Error).message}`);
    return false;
  }
}

// ---------- rate limiting (fixed window in Valkey) ----------
export async function rateLimit(key: string, limit: number, windowSec: number) {
  try {
    const k = `rl:${key}`;
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, windowSec);
    return n <= limit;
  } catch {
    return true; // fail open if cache is down
  }
}

// ---------- moderation events ----------
export type ModEvent = {
  id: string; ts: number; origin: string; type: string; severity: 'block' | 'warn' | 'info';
  room?: string; identity?: string; name?: string; detail: string; [k: string]: unknown;
};

export async function publishEvent(ev: Omit<ModEvent, 'id' | 'ts'>) {
  const full: ModEvent = { id: Math.random().toString(36).slice(2, 14), ts: Date.now(), ...ev } as ModEvent;
  const data = JSON.stringify(full);
  try {
    await redis().multi().lpush('mod:events:log', data).ltrim('mod:events:log', 0, 299).publish('mod:events', data).exec();
  } catch {}
  return full;
}

// ---------- text moderation ----------
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export type TextVerdict = {
  allowed: boolean; flags: string[]; masked: string; scores?: Record<string, number>;
  model: string; latency_ms: number; cached?: boolean;
};

export async function moderateText(text: string): Promise<TextVerdict> {
  const t0 = performance.now();

  // Fast-path: Synchronous, highly optimized local profanity matcher (< 1ms)
  const matches = matcher.getAllMatches(text);
  const chars = [...text];
  for (const m of matches) {
    for (let i = m.startIndex; i <= m.endIndex; i++) {
      if (chars[i] && chars[i] !== ' ') chars[i] = '*';
    }
  }

  // If local obscenity matched profanity, return verdict instantly without waiting for network
  if (matches.length > 0) {
    return {
      allowed: false,
      flags: ['profanity'],
      masked: chars.join(''),
      model: 'obscenity-fast',
      latency_ms: Math.round(performance.now() - t0),
    };
  }

  // Only query external AI moderator service if configured and fast (timeout 400ms)
  if (MODERATOR_URL && MODERATOR_URL !== 'http://localhost:8000') {
    try {
      const res = await fetch(`${MODERATOR_URL}/moderate/text`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(400),
      });
      if (res.ok) {
        const v = await res.json();
        return { ...v, latency_ms: Math.round(performance.now() - t0) };
      }
    } catch {}
  }

  return {
    allowed: true,
    flags: [],
    masked: text,
    model: 'obscenity-fast',
    latency_ms: Math.round(performance.now() - t0),
  };
}
