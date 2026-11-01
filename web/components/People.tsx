'use client';
import { Track } from 'livekit-client';
import { useParticipants } from '@livekit/components-react';
import { useApi } from './useApi';

type Session = { token: string; identity: string; role: string };

export default function People({ session }: { session: Session }) {
  const participants = useParticipants();
  const api = useApi(session.token);
  const isMod = session.role === 'moderator';
  const act = (body: Record<string, unknown>) => api('/api/mod/action', body);

  return (
    <div className="people">
      {participants.map((p) => {
        const role = p.attributes?.role || 'viewer';
        const cam = p.getTrackPublication(Track.Source.Camera);
        const screen = p.getTrackPublication(Track.Source.ScreenShare);
        const mic = p.getTrackPublication(Track.Source.Microphone);
        const who = { identity: p.identity, name: p.name };
        return (
          <div key={p.identity} className="card person">
            <div className="row">
              <b className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.identity}{p.isLocal ? ' (you)' : ''}</b>
              <span className={`pill ${role === 'host' ? 'live' : ''}`}>{role}</span>
            </div>
            <div className="row wrap muted" style={{ fontSize: 12 }}>
              {cam && <span>📷 {cam.isMuted ? 'off' : 'on'}</span>}
              {mic && <span>🎙 {mic.isMuted ? 'off' : 'on'}</span>}
              {screen && <span>🖥 {screen.isMuted ? 'off' : 'sharing'}</span>}
              {p.isSpeaking && <span style={{ color: 'var(--accent)' }}>speaking</span>}
            </div>
            {isMod && !p.isLocal && (
              <div className="row wrap">
                {cam && !cam.isMuted && <button className="btn sm" onClick={() => act({ action: 'mute_track', trackSid: cam.trackSid, ...who })}>Mute cam</button>}
                {mic && !mic.isMuted && <button className="btn sm" onClick={() => act({ action: 'mute_track', trackSid: mic.trackSid, ...who })}>Mute mic</button>}
                {screen && !screen.isMuted && <button className="btn sm" onClick={() => act({ action: 'mute_track', trackSid: screen.trackSid, ...who })}>Stop screen</button>}
                <button className="btn sm" onClick={() => act({ action: 'chat_ban', ...who })}>Mute chat</button>
                <button className="btn sm" onClick={() => act({ action: 'chat_unban', ...who })}>Unmute chat</button>
                <button className="btn sm danger" onClick={() => act({ action: 'kick', ...who })}>Kick</button>
              </div>
            )}
          </div>
        );
      })}
      {isMod && <button className="btn sm danger" onClick={() => act({ action: 'clear_chat' })}>Clear chat for everyone</button>}
    </div>
  );
}
