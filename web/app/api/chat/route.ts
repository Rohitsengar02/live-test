import { broadcast, CHAT_POLICY, handle, HttpError, moderateText, publishEvent, rateLimit, redis, verifyRequest } from '@/lib/server';

export const dynamic = 'force-dynamic';

export type ChatMessage = { id: string; ts: number; identity: string; name: string; role: string; text: string; masked?: boolean };

// GET /api/chat?room=xyz → last 100 messages from the Valkey cache (instant history for late joiners)
export const GET = handle(async (req) => {
  const room = new URL(req.url).searchParams.get('room');
  if (!room) throw new HttpError(400, 'room required');
  let list: string[] = [];
  try { list = await redis().lrange(`chat:${room}`, 0, 99); } catch {}
  return Response.json({ messages: list.map((m) => JSON.parse(m)).reverse() });
});

// POST /api/chat {text} with Authorization: Bearer <livekit token>
export const POST = handle(async (req) => {
  const me = await verifyRequest(req);
  const { text } = (await req.json()) as { text?: string };
  const clean = (text || '').trim();
  if (!clean) throw new HttpError(400, 'empty message');

  if (!(await rateLimit(`chat:${me.room}:${me.identity}`, 5, 5))) {
    return Response.json({ ok: false, blocked: true, reason: 'slow down — max 5 messages / 5s' }, { status: 429 });
  }
  try {
    if (await redis().sismember(`chatban:${me.room}`, me.identity)) {
      return Response.json({ ok: false, blocked: true, reason: 'you are muted in chat by a moderator' }, { status: 403 });
    }
  } catch {}

  const v = await moderateText(clean);
  const onlyProfanity = v.flags.length > 0 && v.flags.every((f) => f === 'profanity');
  const deliverMasked = !v.allowed && onlyProfanity && CHAT_POLICY === 'mask';

  if (!v.allowed && !deliverMasked) {
    await publishEvent({
      origin: 'web', type: 'text', severity: 'block', room: me.room, identity: me.identity, name: me.name,
      detail: `Blocked message (${v.flags.join(', ')})`, text: clean, flags: v.flags, scores: v.scores, model: v.model, latency_ms: v.latency_ms,
    });
    return Response.json({ ok: false, blocked: true, reason: `blocked: ${v.flags.join(', ')}`, verdict: v }, { status: 422 });
  }

  const msg: ChatMessage = {
    id: Math.random().toString(36).slice(2, 12), ts: Date.now(), identity: me.identity, name: me.name, role: me.role,
    text: deliverMasked ? v.masked : clean, masked: deliverMasked || undefined,
  };
  try {
    await redis().multi().lpush(`chat:${me.room}`, JSON.stringify(msg)).ltrim(`chat:${me.room}`, 0, 99).expire(`chat:${me.room}`, 86400).exec();
  } catch {}
  await broadcast(me.room, 'chat', { kind: 'message', message: msg });
  if (deliverMasked) {
    await publishEvent({
      origin: 'web', type: 'text', severity: 'warn', room: me.room, identity: me.identity, name: me.name,
      detail: 'Profanity masked', text: clean, flags: v.flags, model: v.model, latency_ms: v.latency_ms,
    });
  }
  return Response.json({ ok: true, message: msg, verdict: { flags: v.flags, model: v.model, latency_ms: v.latency_ms, cached: v.cached } });
});
