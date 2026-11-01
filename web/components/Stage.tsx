'use client';
import { useState, useEffect } from 'react';
import { Track } from 'livekit-client';
import { ControlBar, GridLayout, ParticipantTile, useTracks, TrackRefContext, useDataChannel } from '@livekit/components-react';
import { isTrackReference } from '@livekit/components-core';

const dec = new TextDecoder();

export default function Stage({ isHost = false }: { isHost?: boolean }) {
  const [blurAlert, setBlurAlert] = useState<{ active: boolean; message: string; subtext: string }>({
    active: false,
    message: '',
    subtext: '',
  });

  useDataChannel('moderation', (packet) => {
    try {
      const d = JSON.parse(dec.decode(packet.payload));
      if (d.kind === 'video_blocked') {
        const who = d.name || 'Streamer';
        setBlurAlert({
          active: true,
          message: '⚠️ Sensitive / Explicit Visual Content Detected',
          subtext: `${who}'s stream was automatically blurred and video paused to protect viewers.`,
        });
      } else if (d.kind === 'speech_blocked') {
        const who = d.name || 'Streamer';
        setBlurAlert({
          active: true,
          message: '⚠️ Inappropriate / Profane Speech Detected',
          subtext: `${who} spoke prohibited words. Audio & stream temporarily blurred.`,
        });
        // Auto-dismiss speech blur after 8 seconds
        setTimeout(() => {
          setBlurAlert((prev) => ({ ...prev, active: false }));
        }, 8000);
      }
    } catch {}
  });

  // Host local notification dismissal
  useEffect(() => {
    const handleHostLocalNsfw = (e: CustomEvent<{ message: string; subtext: string }>) => {
      setBlurAlert({
        active: true,
        message: e.detail.message,
        subtext: e.detail.subtext,
      });
    };
    window.addEventListener('host-nsfw-alert' as any, handleHostLocalNsfw);
    return () => window.removeEventListener('host-nsfw-alert' as any, handleHostLocalNsfw);
  }, []);

  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ).filter((t) => (t.participant.attributes?.role || 'viewer') === 'host' && isTrackReference(t) && !t.publication.isMuted);

  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);

  if (tracks.length === 0) {
    return (
      <div className="waiting">
        <div>
          <div style={{ fontSize: 40 }}>📡</div>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>Waiting for the host to go live</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Video, screen share and chat appear here in real time.</div>
        </div>
      </div>
    );
  }

  const stageContent = screens.length > 0 ? (
    <div className="focus">
      <TrackRefContext.Provider value={screens[0]}>
        <ParticipantTile trackRef={screens[0]} />
      </TrackRefContext.Provider>
      <div className="focus-strip">
        {[...screens.slice(1), ...cams].map((t) => (
          <ParticipantTile key={`${t.participant.identity}-${t.source}`} trackRef={t} />
        ))}
      </div>
    </div>
  ) : (
    <GridLayout tracks={cams}>
      <ParticipantTile />
    </GridLayout>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {stageContent}
      {blurAlert.active && (
        <div className="stage-blur-overlay">
          <div className="alert-icon">⚠️</div>
          <h2>{blurAlert.message}</h2>
          <p>{blurAlert.subtext}</p>
          {isHost && (
            <button
              className="btn sm"
              style={{ marginTop: 14 }}
              onClick={() => setBlurAlert({ active: false, message: '', subtext: '' })}
            >
              Dismiss Warning
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function HostControls() {
  return (
    <div className="controls card" style={{ padding: 8 }}>
      <ControlBar variation="minimal" controls={{ camera: true, microphone: true, screenShare: true, chat: false, leave: true }} />
      <span className="muted" style={{ fontSize: 12 }}>Screen share works in desktop Chrome / Edge / Firefox.</span>
    </div>
  );
}
