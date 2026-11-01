'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DisconnectReason } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer, useParticipants, useConnectionState } from '@livekit/components-react';
import Stage, { HostControls } from './Stage';
import Chat from './Chat';
import People from './People';
import Reactions from './Reactions';
import ModToasts from './ModToasts';
import NsfwGuard from './NsfwGuard';
import AudioGuard from './AudioGuard';

type Role = 'host' | 'viewer' | 'moderator';
type Session = { token: string; identity: string; url: string; room: string; role: Role; name: string };

function livekitUrl(fromServer: string) {
  if (fromServer) return fromServer;
  // Behind Caddy: LiveKit signalling is proxied on the same origin (/rtc)
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

export default function RoomClient({ room, role, initialName }: { room: string; role: Role; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState<string | null>(null);

  const join = useCallback(async (n: string) => {
    setError('');
    const password = role === 'moderator' ? sessionStorage.getItem('sg:modpw') || prompt('Moderator password') || '' : undefined;
    const res = await fetch('/api/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room, name: n, role, password }) });
    const d = await res.json();
    if (!res.ok) return setError(d.error || 'could not join');
    if (role === 'moderator' && password) sessionStorage.setItem('sg:modpw', password);
    setSession({ ...d, url: livekitUrl(d.url), name: n });
  }, [room, role]);

  useEffect(() => { if (initialName) join(initialName); }, [initialName, join]);

  if (ended) {
    return (
      <div className="home" style={{ textAlign: 'center', paddingTop: 120 }}>
        <h1 style={{ fontSize: 28 }}>{ended}</h1>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <a className="btn" href="/">Back home</a>
          {!ended.includes('removed') && <button className="btn primary" onClick={() => { setEnded(null); join(name); }}>Rejoin</button>}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <form className="home" style={{ maxWidth: 420, paddingTop: 100, display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) join(name.trim()); }}>
        <div className="brand"><span className="brand-mark" /> Join “{room}” as {role}</div>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={32} />
        <button className="btn primary" type="submit">{initialName && !error ? 'Connecting…' : 'Join'}</button>
        {error && <div className="chat-error" style={{ margin: 0 }}>{error}</div>}
      </form>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.url}
      token={session.token}
      connect
      video={role === 'host'}
      audio={role === 'host'}
      options={{ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } }}
      onDisconnected={(reason) => {
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) setEnded('You were removed from the room by moderation.');
        else if (reason === DisconnectReason.CLIENT_INITIATED) location.href = '/';
        else setEnded('Disconnected from the room.');
      }}
      onError={(e) => setError(e.message)}
      className="room"
      data-lk-theme="default"
    >
      <RoomUI session={session} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function RoomUI({ session }: { session: Session }) {
  const participants = useParticipants();
  const state = useConnectionState();
  const [tab, setTab] = useState<'chat' | 'people'>('chat');

  const { hosts, viewers } = useMemo(() => {
    const role = (p: (typeof participants)[number]) => p.attributes?.role || 'viewer';
    return {
      hosts: participants.filter((p) => role(p) === 'host'),
      viewers: participants.filter((p) => role(p) === 'viewer'),
    };
  }, [participants]);
  const isLive = hosts.some((h) => h.isCameraEnabled || h.isScreenShareEnabled);

  return (
    <>
      <header className="topbar">
        <a href="/" className="brand" style={{ textDecoration: 'none' }}><span className="brand-mark" /></a>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.room}</strong>
        {isLive ? <span className="pill live"><span className="dot" />LIVE</span> : <span className="pill">offline</span>}
        <span className="pill">👁 {viewers.length}</span>
        <div className="grow" />
        <span className={`pill ${state === 'connected' ? 'ok' : 'warn'}`}><span className="dot" />{state}</span>
        <span className="pill">{session.role}{session.role === 'moderator' ? ' (hidden)' : ''}</span>
      </header>

      <div className="room-body">
        <div className="stage-wrap">
          <div className="stage">
            <Stage isHost={session.role === 'host'} />
            <Reactions token={session.token} />
          </div>
          {session.role === 'host' && <HostControls />}
          {session.role === 'host' && <NsfwGuard token={session.token} />}
          {session.role === 'host' && <AudioGuard token={session.token} />}
          {session.role !== 'host' && <ViewerBar />}
        </div>

        <aside className="sidebar">
          <div className="tabs">
            <button className={`tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>Chat</button>
            <button className={`tab ${tab === 'people' ? 'on' : ''}`} onClick={() => setTab('people')}>People ({participants.length})</button>
          </div>
          <div style={{ display: tab === 'chat' ? 'contents' : 'none' }}>
            <Chat session={session} />
          </div>
          {tab === 'people' && <People session={session} />}
        </aside>
      </div>
      <ModToasts me={session.identity} />
    </>
  );
}

function ViewerBar() {
  return (
    <div className="controls card" style={{ padding: 8 }}>
      <span className="muted" style={{ fontSize: 13 }}>You are watching. Send reactions with the buttons on the video, chat on the right.</span>
      <div className="grow" />
      <a className="btn sm" href="/">Leave</a>
    </div>
  );
}
