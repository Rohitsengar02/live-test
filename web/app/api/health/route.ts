import { MODERATOR_URL, redis, rooms } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const check = async (fn: () => Promise<unknown>) => { try { return { ok: true, info: await fn() }; } catch (e) { return { ok: false, info: (e as Error).message }; } };
  const [cache, livekit, moderator] = await Promise.all([
    check(() => redis().ping()),
    check(async () => `${(await rooms().listRooms()).length} rooms`),
    check(async () => (await fetch(`${MODERATOR_URL}/health`, { signal: AbortSignal.timeout(2000) })).json()),
  ]);
  return Response.json({ cache, livekit, moderator });
}
