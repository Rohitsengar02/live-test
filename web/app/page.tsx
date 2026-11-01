'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type RoomInfo = {
  name: string; automod: boolean; moderators: number;
  participants: { identity: string; name: string; role: string; tracks: { source: string; muted: boolean }[] }[];
};
type Health = { cache: { ok: boolean }; livekit: { ok: boolean; info: string }; moderator: { ok: boolean; info: { text_model?: string } } };

const randomRoom = () => `room-${Math.random().toString(36).slice(2, 6)}`;

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsErr, setRoomsErr] = useState('');
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    setName(localStorage.getItem('sg:name') || '');
    setRoom(randomRoom());
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    let alive = true;
    const poll = async () => {
      try {
        const d = await (await fetch('/api/rooms', { cache: 'no-store' })).json();
        if (alive) { setRooms(d.rooms || []); setRoomsErr(d.error || ''); }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const go = (role: 'host' | 'viewer', r = room) => {
    const n = name.trim() || `guest-${Math.random().toString(36).slice(2, 5)}`;
    localStorage.setItem('sg:name', n);
    router.push(`/room/${encodeURIComponent(r.trim().toLowerCase())}?role=${role}&name=${encodeURIComponent(n)}`);
  };

  return (
    <main className="home">
      <div className="row">
        <div className="brand"><span className="brand-mark" /> StreamGuard</div>
        <div className="grow" />
        <a className="btn" href="/moderator">Moderator dashboard</a>
      </div>

      <section className="hero">
        <h1>Live streaming with real-time AI moderation, fully open source.</h1>
        <p>
          Self-hosted LiveKit for video, screen share and chat. NudeNet watches every stream (in the
          browser and on the server), toxic-bert and a Hindi/English word filter check every chat message.
          Open this page on another device to watch changes happen live.
        </p>
        {health && (
          <div className="stack">
            <span className={`pill ${health.livekit.ok ? 'ok' : 'bad'}`}><span className="dot" />LiveKit</span>
            <span className={`pill ${health.cache.ok ? 'ok' : 'bad'}`}><span className="dot" />Valkey cache</span>
            <span className={`pill ${health.moderator.ok ? 'ok' : 'bad'}`}>
              <span className="dot" />Moderator {health.moderator.ok ? `· ${health.moderator.info.text_model}` : 'offline (fallback filter)'}
            </span>
          </div>
        )}
      </section>

      <div className="home-grid">
        <form className="card join" onSubmit={(e) => { e.preventDefault(); go('host'); }}>
          <label className="field">Your name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohit" maxLength={32} />
          </label>
          <label className="field">Room
            <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="room name" maxLength={40} />
          </label>
          <button className="btn live" type="submit">● Go live as host</button>
          <button className="btn" type="button" onClick={() => go('viewer')}>Join as viewer</button>
          <p className="muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            Hosts can publish camera, mic and screen share. Viewers can watch, chat and react. Every chat
            message goes through the server moderation pipeline before anyone sees it.
          </p>
        </form>

        <section>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Live now</h2>
            <span className="pill">{rooms.length} room{rooms.length === 1 ? '' : 's'}</span>
          </div>
          {roomsErr && <div className="empty" style={{ marginBottom: 10, color: 'var(--block)' }}>{roomsErr}</div>}
          {rooms.length === 0 ? (
            <div className="empty">No live rooms yet. Start one on the left, then open this page on your phone to join it.</div>
          ) : (
            <div className="room-list">
              {rooms.map((r) => {
                const hosts = r.participants.filter((p) => p.role === 'host');
                const viewers = r.participants.length - hosts.length;
                const sharing = r.participants.some((p) => p.tracks.some((t) => t.source === 'screen_share' && !t.muted));
                return (
                  <div key={r.name} className="card room-card">
                    {hosts.length > 0 && <span className="pill live"><span className="dot" />LIVE</span>}
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {hosts.map((h) => h.name).join(', ') || 'no host yet'} · {viewers} watching{sharing ? ' · sharing screen' : ''}
                      </div>
                    </div>
                    {r.automod && <span className="pill ok" title="AutoMod bot is scanning this room">🛡 AutoMod</span>}
                    <button className="btn sm" onClick={() => go('viewer', r.name)}>Watch</button>
                    <button className="btn sm" onClick={() => go('host', r.name)}>Co-host</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
