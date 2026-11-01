'use client';
import { useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import { useApi } from './useApi';

const EMOJIS = ['❤️', '🔥', '👏', '😂', '😮', '🎉'];
const dec = new TextDecoder();

export default function Reactions({ token }: { token: string }) {
  const api = useApi(token);
  const [floating, setFloating] = useState<{ id: string; emoji: string; left: number }[]>([]);

  useDataChannel('reaction', (packet) => {
    try {
      const d = JSON.parse(dec.decode(packet.payload));
      const item = { id: d.id, emoji: d.emoji, left: Math.random() * 50 };
      setFloating((f) => [...f.slice(-30), item]);
      setTimeout(() => setFloating((f) => f.filter((x) => x.id !== item.id)), 2700);
    } catch {}
  });

  return (
    <>
      <div className="reactions">
        {floating.map((f) => <span key={f.id} className="float-emoji" style={{ left: f.left }}>{f.emoji}</span>)}
      </div>
      <div className="row" style={{ position: 'absolute', left: 12, bottom: 12, gap: 6, zIndex: 4 }}>
        {EMOJIS.map((e) => (
          <button key={e} className="btn sm" style={{ background: '#000a', fontSize: 16 }} onClick={() => api('/api/react', { emoji: e })}>{e}</button>
        ))}
      </div>
    </>
  );
}
