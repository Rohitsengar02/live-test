import { broadcast, checkModPassword, handle, HttpError, publishEvent, redis, rooms, verifyRequest } from '@/lib/server';

type Body = {
  password?: string; room?: string; identity?: string; name?: string;
  action: 'kick' | 'mute_track' | 'chat_ban' | 'chat_unban' | 'delete_message' | 'clear_chat';
  trackSid?: string; messageId?: string;
};

// Moderators authenticate either with the password (dashboard) or with a
// moderator LiveKit token (when watching inside a room).
export const POST = handle(async (req) => {
  const b = (await req.json()) as Body;
  let by = 'dashboard';
  let room = b.room;
  if (req.headers.get('authorization')) {
    const me = await verifyRequest(req);
    if (me.role !== 'moderator') throw new HttpError(403, 'moderators only');
    by = me.name; room = me.room;
  } else {
    checkModPassword(b.password);
  }
  if (!room) throw new HttpError(400, 'room required');
  const who = b.name || b.identity || '';
  let detail = '';

  switch (b.action) {
    case 'kick':
      if (!b.identity) throw new HttpError(400, 'identity required');
      await rooms().removeParticipant(room, b.identity);
      detail = `${who} removed from room`;
      break;
    case 'mute_track':
      if (!b.identity || !b.trackSid) throw new HttpError(400, 'identity & trackSid required');
      await rooms().mutePublishedTrack(room, b.identity, b.trackSid, true);
      detail = `Muted a track of ${who}`;
      break;
    case 'chat_ban':
      await redis().sadd(`chatban:${room}`, b.identity!);
      detail = `${who} muted in chat`;
      break;
    case 'chat_unban':
      await redis().srem(`chatban:${room}`, b.identity!);
      detail = `${who} can chat again`;
      break;
    case 'delete_message': {
      if (!b.messageId) throw new HttpError(400, 'messageId required');
      const list = await redis().lrange(`chat:${room}`, 0, 99);
      const hit = list.find((m) => JSON.parse(m).id === b.messageId);
      if (hit) await redis().lrem(`chat:${room}`, 1, hit);
      detail = 'Deleted a chat message';
      break;
    }
    case 'clear_chat':
      await redis().del(`chat:${room}`);
      detail = 'Cleared chat';
      break;
    default:
      throw new HttpError(400, 'unknown action');
  }

  if (b.action === 'delete_message' || b.action === 'clear_chat') {
    await broadcast(room, 'chat', { kind: b.action === 'clear_chat' ? 'clear' : 'delete', id: b.messageId });
  } else {
    await broadcast(room, 'moderation', { kind: 'action', action: b.action, identity: b.identity, name: who, by, ts: Date.now() });
  }
  await publishEvent({ origin: 'moderator', type: 'action', severity: 'info', room, identity: b.identity, name: who, detail: `${detail} (by ${by})` });
  return Response.json({ ok: true });
});
