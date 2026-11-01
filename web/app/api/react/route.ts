import { broadcast, handle, HttpError, rateLimit, verifyRequest } from '@/lib/server';

const ALLOWED = ['❤️', '🔥', '👏', '😂', '😮', '🎉'];

export const POST = handle(async (req) => {
  const me = await verifyRequest(req);
  const { emoji } = (await req.json()) as { emoji?: string };
  if (!emoji || !ALLOWED.includes(emoji)) throw new HttpError(400, 'bad emoji');
  if (!(await rateLimit(`react:${me.room}:${me.identity}`, 10, 3))) return Response.json({ ok: false }, { status: 429 });
  await broadcast(me.room, 'reaction', { emoji, name: me.name, id: Math.random().toString(36).slice(2) });
  return Response.json({ ok: true });
});
