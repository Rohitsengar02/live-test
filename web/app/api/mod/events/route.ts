import { checkModPassword, redis, redisSubscriber } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server-Sent Events: pushes every moderation event (text, video, actions) live.
export async function GET(req: Request) {
  try { checkModPassword(new URL(req.url).searchParams.get('password')); } catch { return new Response('unauthorized', { status: 401 }); }

  const enc = new TextEncoder();
  const sub = redisSubscriber();
  let ping: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`)); } catch {}
      };
      try {
        const recent = await redis().lrange('mod:events:log', 0, 49);
        send('history', JSON.stringify(recent.map((r) => JSON.parse(r))));
      } catch { send('history', '[]'); }
      sub.on('message', (_ch, msg) => send('event', msg));
      sub.subscribe('mod:events').catch(() => {});
      ping = setInterval(() => send('ping', String(Date.now())), 15000);
    },
    cancel() {
      clearInterval(ping);
      sub.quit().catch(() => {});
    },
  });
  req.signal.addEventListener('abort', () => { clearInterval(ping); sub.quit().catch(() => {}); });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
