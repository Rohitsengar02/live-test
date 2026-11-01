import { broadcast, handle, publishEvent, rateLimit, verifyRequest } from '@/lib/server';

// Reports from the in-browser NudeNet guard (the publisher's own device).
export const POST = handle(async (req) => {
  const me = await verifyRequest(req);
  if (!(await rateLimit(`report:${me.identity}`, 6, 10))) return Response.json({ ok: false }, { status: 429 });
  const b = (await req.json()) as { source: string; verdict: string; score: number; labels: string[]; latency_ms: number; action: string };
  const severity = b.verdict === 'nude' ? 'block' : 'warn';
  await publishEvent({
    origin: 'browser', type: 'video', severity, room: me.room, identity: me.identity, name: me.name, source: b.source,
    detail: `In-browser NudeNet: ${b.verdict} on ${b.source} (${b.score}) → ${b.action}`,
    labels: b.labels, latency_ms: b.latency_ms, action: b.action,
  });
  if (severity === 'block') {
    await broadcast(me.room, 'moderation', { kind: 'video_blocked', identity: me.identity, name: me.name, source: b.source, action: b.action, origin: 'browser', ts: Date.now() });
  }
  return Response.json({ ok: true });
});
