'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { timeAgo } from '@/components/useApi';

type ModEvent = {
  id: string; ts: number; origin: string; type: string; severity: 'block' | 'warn' | 'info';
  room?: string; identity?: string; name?: string; detail: string; text?: string;
  labels?: string[]; flags?: string[]; latency_ms?: number; model?: string;
};
type Track = { sid: string; type: string; source: string; muted: boolean };
type RoomInfo = { name: string; automod: boolean; moderators: number; participants: { identity: string; name: string; role: string; tracks: Track[] }[] };

export default function Moderator() {
  const [pw, setPw] = useState('');
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const saved = sessionStorage.getItem('sg:modpw');
    if (saved) { setPw(saved); setAuthed(true); }
  }, []);

  if (!authed) {
    return (
      <form className="home" style={{ maxWidth: 420, paddingTop: 100, display: 'grid', gap: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await fetch(`/api/mod/events?password=${encodeURIComponent(pw)}`, { method: 'GET' });
          r.body?.cancel();
          if (r.ok) { sessionStorage.setItem('sg:modpw', pw); setAuthed(true); } else setErr('Wrong password');
        }}>
        <div className="brand"><span className="brand-mark" /> Moderator login</div>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="MOD_PASSWORD (default admin123)" />
        <button className="btn primary">Open dashboard</button>
        {err && <div className="chat-error" style={{ margin: 0 }}>{err}</div>}
      </form>
    );
  }
  return <Dashboard pw={pw} />;
}

function Dashboard({ pw }: { pw: string }) {
  const [events, setEvents] = useState<ModEvent[]>([]);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<'all' | 'text' | 'video' | 'action'>('all');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [, tick] = useState(0);

  // live event stream (SSE ← Valkey pub/sub)
  useEffect(() => {
    const es = new EventSource(`/api/mod/events?password=${encodeURIComponent(pw)}`);
    es.addEventListener('history', (e) => setEvents(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('event', (e) => setEvents((p) => [JSON.parse((e as MessageEvent).data), ...p].slice(0, 300)));
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [pw]);

  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const d = await (await fetch('/api/rooms', { cache: 'no-store' })).json(); if (alive) setRooms(d.rooms || []); } catch {} };
    poll();
    const t = setInterval(poll, 2000);
    const t2 = setInterval(() => tick((n) => n + 1), 5000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, []);

  const act = async (room: string, body: Record<string, unknown>) => {
    await fetch('/api/mod/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw, room, ...body }) });
  };

  const stats = useMemo(() => ({
    text: events.filter((e) => e.type === 'text' && e.severity === 'block').length,
    masked: events.filter((e) => e.type === 'text' && e.severity === 'warn').length,
    video: events.filter((e) => e.type === 'video' && e.severity === 'block').length,
    people: rooms.reduce((n, r) => n + r.participants.length, 0),
  }), [events, rooms]);

  const shown = events.filter((e) => filter === 'all' || e.type === filter || (filter === 'action' && e.type === 'system'));

  return (
    <main className="mod">
      <div className="row wrap">
        <a href="/" className="brand" style={{ textDecoration: 'none' }}><span className="brand-mark" /> StreamGuard</a>
        <span className="pill">Moderator</span>
        <span className={`pill ${live ? 'ok' : 'bad'}`}><span className="dot" />{live ? 'live feed' : 'reconnecting'}</span>
        <div className="grow" />
        <button className="btn sm" onClick={() => { sessionStorage.removeItem('sg:modpw'); location.reload(); }}>Log out</button>
      </div>

      <div className="stats" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="muted">Messages blocked</span><b>{stats.text}</b></div>
        <div className="card stat"><span className="muted">Messages masked</span><b>{stats.masked}</b></div>
        <div className="card stat"><span className="muted">Video blocks</span><b>{stats.video}</b></div>
        <div className="card stat"><span className="muted">People online</span><b>{stats.people}</b></div>
      </div>

      <div className="mod-grid">
        <section className="card">
          <div className="panel-h">
            Live events <div className="grow" />
            {(['all', 'text', 'video', 'action'] as const).map((f) => (
              <button key={f} className={`btn sm ${filter === f ? 'primary' : ''}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="feed">
            {shown.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>Nothing yet. Send a rude chat message or go live in a room to see events stream in.</div>}
            {shown.map((e) => (
              <div key={e.id} className={`event sev-${e.severity}`}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <b>{e.type === 'text' ? '💬' : e.type === 'video' ? '🎥' : e.type === 'action' ? '🔨' : 'ℹ️'} {e.detail}</b>
                </div>
                {e.text && <div className="text">{e.text}</div>}
                {e.labels && e.labels.length > 0 && <div className="mono muted">{[...new Set(e.labels)].join(' · ')}</div>}
                <div className="row wrap muted" style={{ fontSize: 12, gap: 8 }}>
                  {e.name && <span>{e.name}</span>}
                  {e.room && <span>#{e.room}</span>}
                  <span>{e.origin}{e.model ? ` · ${e.model}` : ''}</span>
                  {e.latency_ms != null && <span>{e.latency_ms}ms</span>}
                  <span>{timeAgo(e.ts)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="panel-h">Rooms <span className="pill">{rooms.length}</span></div>
          <div className="feed">
            {rooms.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>No active rooms.</div>}
            {rooms.map((r) => (
              <div key={r.name} className="event" style={{ gap: 10 }}>
                <div className="row">
                  <b className="grow">#{r.name}</b>
                  {r.automod ? <span className="pill ok">🛡 AutoMod in room</span> : <span className="pill warn">AutoMod joining…</span>}
                  <a className="btn sm" href={`/room/${r.name}?role=moderator&name=Moderator`} target="_blank">Watch hidden</a>
                </div>
                {r.participants.map((p) => (
                  <div key={p.identity} className="row wrap" style={{ gap: 6, fontSize: 13 }}>
                    <span className={`pill ${p.role === 'host' ? 'live' : ''}`}>{p.role}</span>
                    <span className="grow">{p.name}</span>
                    {p.tracks.filter((t) => t.type === 'video' || t.source === 'microphone').map((t) => (
                      <button key={t.sid} className="btn sm" disabled={t.muted}
                        onClick={() => act(r.name, { action: 'mute_track', identity: p.identity, name: p.name, trackSid: t.sid })}>
                        {t.muted ? `${t.source} off` : `Mute ${t.source.replace('_', ' ')}`}
                      </button>
                    ))}
                    <button className="btn sm" onClick={() => act(r.name, { action: 'chat_ban', identity: p.identity, name: p.name })}>Mute chat</button>
                    <button className="btn sm danger" onClick={() => act(r.name, { action: 'kick', identity: p.identity, name: p.name })}>Kick</button>
                  </div>
                ))}
                <div className="row"><button className="btn sm danger" onClick={() => act(r.name, { action: 'clear_chat' })}>Clear chat</button></div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="panel-h">Test bench</div>
          <TextBench />
          <div style={{ borderTop: '1px solid var(--line)' }} />
          <ImageBench />
        </section>
      </div>
    </main>
  );
}

type TextVerdict = { allowed: boolean; flags: string[]; masked: string; scores?: Record<string, number>; model: string; latency_ms: number; cached?: boolean };

function TextBench() {
  const [text, setText] = useState('');
  const [v, setV] = useState<TextVerdict | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/mod/test-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    setV(await r.json());
  };
  return (
    <form className="section" onSubmit={run}>
      <b>Text moderation</b>
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Try: 'you are an idiot', 'f.u.c.k', 'tu chutiya hai', 'call 9876543210', 'visit spam.xyz'" />
      <button className="btn primary" disabled={!text.trim()}>Check</button>
      {v && (
        <div className="section card" style={{ background: 'var(--panel-2)' }}>
          <div className="row wrap">
            <span className={`pill ${v.allowed ? 'ok' : 'bad'}`}>{v.allowed ? 'allowed' : 'flagged'}</span>
            {v.flags.map((f) => <span key={f} className="pill warn">{f}</span>)}
          </div>
          <div className="mono">{v.masked}</div>
          {v.scores && Object.entries(v.scores).map(([k, s]) => (
            <div key={k} className="scorebar">
              <span className="muted">{k}</span>
              <div className="bar"><i style={{ width: `${s * 100}%`, background: s > 0.7 ? 'var(--block)' : s > 0.4 ? 'var(--warn)' : 'var(--accent)' }} /></div>
              <span className="mono">{s.toFixed(2)}</span>
            </div>
          ))}
          <div className="muted mono">{v.model} · {v.latency_ms}ms{v.cached ? ' · cache hit' : ''}</div>
        </div>
      )}
    </form>
  );
}

type Det = { label?: string; class?: string; score: number; box: number[] };
type ImgResult = { verdict: string; score: number; detections: Det[]; ms: number; error?: string };

function ImageBench() {
  const [url, setUrl] = useState('');
  const [server, setServer] = useState<ImgResult | null>(null);
  const [browser, setBrowser] = useState<ImgResult | null>(null);
  const [busy, setBusy] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onFile = async (file: File) => {
    setServer(null); setBrowser(null);
    setUrl(URL.createObjectURL(file));
    setBusy('server');
    const fd = new FormData();
    fd.append('file', file);
    const t0 = performance.now();
    const r = await fetch('/api/mod/test-image', { method: 'POST', body: fd });
    const d = await r.json();
    setServer(r.ok ? { ...d, ms: Math.round(performance.now() - t0) } : { verdict: 'error', score: 0, detections: [], ms: 0, error: d.error });
    setBusy('');
  };

  const runBrowser = async () => {
    if (!imgRef.current) return;
    setBusy('browser (first run downloads ~70 MB, then cached)');
    try {
      const { detectNsfw } = await import('@/lib/nudenet');
      const r = await detectNsfw(imgRef.current, { size: 800 });
      setBrowser({ ...r, detections: r.detections });
    } catch (e) {
      setBrowser({ verdict: 'error', score: 0, detections: [], ms: 0, error: String(e) });
    }
    setBusy('');
  };

  // draw boxes from both engines (server = red, browser = green)
  useEffect(() => {
    const img = imgRef.current, c = canvasRef.current;
    if (!img || !c || !img.naturalWidth) return;
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = Math.max(2, c.width / 300);
    ctx.font = `${Math.max(12, c.width / 40)}px sans-serif`;
    const draw = (dets: Det[] | undefined, color: string) => dets?.forEach((d) => {
      const [x, y, w, h] = d.box;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.strokeRect(x, y, w, h);
      ctx.fillText(`${d.class || d.label} ${Math.round(d.score * 100)}%`, x + 4, y - 4);
    });
    draw(server?.detections, '#f87171');
    draw(browser?.detections, '#6ee7b7');
  }, [server, browser, url]);

  const Res = ({ title, r, color }: { title: string; r: ImgResult | null; color: string }) => r && (
    <div className="row wrap" style={{ fontSize: 13 }}>
      <span className="dot" style={{ color }} /> <b>{title}</b>
      <span className={`pill ${r.verdict === 'nude' ? 'bad' : r.verdict === 'suggestive' ? 'warn' : r.verdict === 'error' ? 'bad' : 'ok'}`}>{r.error ? r.error : r.verdict}</span>
      <span className="muted mono">{r.ms}ms</span>
    </div>
  );

  return (
    <div className="section">
      <b>Video / image moderation</b>
      <span className="muted" style={{ fontSize: 13 }}>Upload a frame to compare the server NudeNet (Python ONNX) with the in-browser NudeNet (TF.js).</span>
      <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {url && (
        <>
          <div className="imgbox">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={url} alt="test upload" onLoad={() => setServer((s) => (s ? { ...s } : s))} />
            <canvas ref={canvasRef} />
          </div>
          <button className="btn" onClick={runBrowser} disabled={!!busy}>Run in-browser NudeNet too</button>
        </>
      )}
      {busy && <span className="muted">running {busy}…</span>}
      <Res title="Server (ONNX)" r={server} color="#f87171" />
      <Res title="Browser (TF.js)" r={browser} color="#6ee7b7" />
    </div>
  );
}
