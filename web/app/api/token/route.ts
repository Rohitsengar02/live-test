import { checkModPassword, handle, HttpError, makeToken, publishEvent, type Role } from '@/lib/server';

function toWsUrl(url: string): string {
  if (url.startsWith('https://')) return url.replace(/^https:\/\//, 'wss://');
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'ws://');
  return url;
}

export const POST = handle(async (req) => {
  const { room, name, role, password } = (await req.json()) as { room?: string; name?: string; role?: Role; password?: string };
  const r = (room || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 40);
  const n = (name || '').trim().slice(0, 32);
  if (!r || !n) throw new HttpError(400, 'room and name are required');
  const safeRole: Role = role === 'host' || role === 'moderator' ? role : 'viewer';
  if (safeRole === 'moderator') checkModPassword(password);
  const { token, identity } = await makeToken(r, n, safeRole);
  if (safeRole === 'host') await publishEvent({ origin: 'web', type: 'system', severity: 'info', room: r, identity, name: n, detail: `${n} went live` });

  const rawUrl = process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL || '';
  const publicUrl = rawUrl.includes('livekit:7880') ? '' : toWsUrl(rawUrl);

  return Response.json({ token, identity, room: r, role: safeRole, url: publicUrl });
});
