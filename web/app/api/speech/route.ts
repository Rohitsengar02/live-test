import { broadcast, handle, moderateText, publishEvent, rateLimit, verifyRequest } from '@/lib/server';

export const POST = handle(async (req) => {
  const me = await verifyRequest(req);
  if (!(await rateLimit(`speech:${me.identity}`, 15, 10))) {
    return Response.json({ ok: false }, { status: 429 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (!text || !text.trim()) {
    return Response.json({ ok: true, allowed: true });
  }

  const verdict = await moderateText(text.trim());

  if (!verdict.allowed) {
    await publishEvent({
      origin: 'speech',
      type: 'audio',
      severity: 'block',
      room: me.room,
      identity: me.identity,
      name: me.name,
      detail: `Profanity/Toxic speech spoken: "${text}" (${verdict.flags.join(', ')})`,
      flags: verdict.flags,
    });

    await broadcast(me.room, 'moderation', {
      kind: 'speech_blocked',
      identity: me.identity,
      name: me.name,
      text: verdict.masked || text,
      flags: verdict.flags,
      origin: 'speech',
      ts: Date.now(),
    });
  }

  return Response.json({ ok: true, verdict });
});

