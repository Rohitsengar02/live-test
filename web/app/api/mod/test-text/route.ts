import { handle, HttpError, moderateText } from '@/lib/server';

// Test bench: run text moderation without sending to a room.
export const POST = handle(async (req) => {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) throw new HttpError(400, 'text required');
  return Response.json(await moderateText(text));
});
