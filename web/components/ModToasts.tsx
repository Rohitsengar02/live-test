'use client';
import { useState } from 'react';
import { useDataChannel } from '@livekit/components-react';

const dec = new TextDecoder();
type Toast = { id: string; text: string; tone: 'block' | 'info' };

const SRC: Record<string, string> = { camera: 'camera', screen_share: 'screen share', video: 'video' };
const ACT: Record<string, string> = { kick: 'was removed', mute_track: 'had a track muted', chat_ban: 'was muted in chat', chat_unban: 'can chat again' };

export default function ModToasts({ me }: { me: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useDataChannel('moderation', (packet) => {
    try {
      const d = JSON.parse(dec.decode(packet.payload));
      const mine = d.identity === me;
      let text = '';
      if (d.kind === 'video_blocked') {
        const by = d.origin === 'browser' ? 'on-device AI' : 'AutoMod';
        text = mine
          ? `🛡 Your ${SRC[d.source] || 'video'} was turned off by ${by}: explicit content detected. ${d.action === 'kicked' ? '' : 'Repeated violations remove you from the room.'}`
          : `🛡 ${by} blocked ${d.name}'s ${SRC[d.source] || 'video'} (${d.action})`;
      } else if (d.kind === 'speech_blocked') {
        text = mine
          ? `⚠️ Warning: Inappropriate speech detected in your audio. Video has been blurred.`
          : `⚠️ Warning: ${d.name} used prohibited words. Stream blurred.`;
      } else if (d.kind === 'action') {
        text = mine ? `🛡 A moderator acted on your account: ${d.action.replace('_', ' ')}` : `🛡 ${d.name} ${ACT[d.action] || d.action}`;
      } else return;
      const t: Toast = { id: Math.random().toString(36).slice(2), text, tone: d.kind === 'action' ? 'info' : 'block' };
      setToasts((x) => [...x.slice(-3), t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), mine ? 9000 : 5000);
    } catch {}
  });

  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone === 'info' ? 'info' : ''}`}>{t.text}</div>)}
    </div>
  );
}
