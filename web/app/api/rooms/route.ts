import { BOT_IDENTITY, handle, redis, rooms } from '@/lib/server';
import { TrackSource, TrackType } from 'livekit-server-sdk';

export const dynamic = 'force-dynamic';

const SRC: Record<number, string> = {
  [TrackSource.CAMERA]: 'camera', [TrackSource.MICROPHONE]: 'microphone',
  [TrackSource.SCREEN_SHARE]: 'screen_share', [TrackSource.SCREEN_SHARE_AUDIO]: 'screen_share_audio',
};

async function load() {
  const list = await rooms().listRooms();
  return Promise.all(
    list.map(async (r) => {
      const ps = await rooms().listParticipants(r.name);
      const visible = ps.filter((p) => p.identity !== BOT_IDENTITY && !p.permission?.hidden);
      return {
        name: r.name,
        createdAt: Number(r.creationTime) * 1000,
        automod: ps.some((p) => p.identity === BOT_IDENTITY),
        moderators: ps.filter((p) => p.permission?.hidden && p.identity !== BOT_IDENTITY).length,
        participants: visible.map((p) => ({
          identity: p.identity,
          name: p.name,
          role: p.attributes?.role || 'viewer',
          joinedAt: Number(p.joinedAt) * 1000,
          tracks: p.tracks.map((t) => ({ sid: t.sid, type: t.type === TrackType.VIDEO ? 'video' : 'audio', source: SRC[t.source] || 'unknown', muted: t.muted })),
        })),
      };
    }),
  );
}

// Cached in Valkey for 2s so many clients polling don't hammer LiveKit.
export const GET = handle(async () => {
  try {
    const hit = await redis().get('cache:rooms');
    if (hit) return Response.json({ rooms: JSON.parse(hit), cached: true });
  } catch {}
  try {
    const data = await load();
    try { await redis().set('cache:rooms', JSON.stringify(data), 'EX', 2); } catch {}
    return Response.json({ rooms: data, cached: false });
  } catch (e) {
    return Response.json({ rooms: [], error: `LiveKit unreachable: ${(e as Error).message}` });
  }
});
