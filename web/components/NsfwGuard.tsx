'use client';
import { useEffect, useRef, useState } from 'react';
import { LocalVideoTrack, Track } from 'livekit-client';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { useApi } from './useApi';
import type { NsfwResult } from '@/lib/nudenet';

type Status = { phase: 'off' | 'loading' | 'ready' | 'error'; progress: number; from?: string; error?: string };
type Last = NsfwResult & { source: string };

/**
 * Runs NudeNet on the host's OWN camera + screen share, inside the browser.
 * On explicit content it switches that source off immediately (before most
 * viewers would even see a frame) and reports to the moderation dashboard.
 * The server-side AutoMod bot is the second, tamper-proof layer.
 */
export default function NsfwGuard({ token }: { token: string }) {
  const api = useApi(token);
  const { localParticipant } = useLocalParticipant();
  const [enabled, setEnabled] = useState(true);
  const [quality, setQuality] = useState(384);
  const [status, setStatus] = useState<Status>({ phase: 'off', progress: 0 });
  const [last, setLast] = useState<Last | null>(null);
  const [scans, setScans] = useState(0);

  const localVideo = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false })
    .filter((t) => t.participant.isLocal && t.publication?.track && !t.publication.isMuted);
  const trackKey = localVideo.map((t) => t.publication!.trackSid).join(',');

  // load model once (cached in IndexedDB after the first time)
  useEffect(() => {
    if (!enabled || status.phase !== 'off') return;
    setStatus({ phase: 'loading', progress: 0 });
    import('@/lib/nudenet')
      .then(async (m) => {
        await m.loadNudeNet((p) => setStatus((s) => ({ ...s, progress: p })));
        setStatus({ phase: 'ready', progress: 1, from: m.loadedFrom ?? undefined });
      })
      .catch((e) => setStatus({ phase: 'error', progress: 0, error: String(e?.message || e) }));
  }, [enabled, status.phase]);

  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  // scan loop per local video track
  useEffect(() => {
    if (!enabled || status.phase !== 'ready' || localVideo.length === 0) return;
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cleanups: (() => void)[] = [];
    const lastWarn: Record<string, number> = {};

    localVideo.forEach((ref) => {
      const track = ref.publication!.track as LocalVideoTrack;
      const source = ref.source === Track.Source.ScreenShare ? 'screen_share' : 'camera';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track.mediaStreamTrack]);
      video.play().catch(() => {});
      let strikes = 0;

      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            const { detectNsfw } = await import('@/lib/nudenet');
            const r = await detectNsfw(video, { size: qualityRef.current });
            setLast({ ...r, source });
            setScans((n) => n + 1);
            if (r.verdict === 'nude') {
              strikes += r.score > 0.7 ? 2 : 1;
              if (strikes >= 2) {
                strikes = 0;
                window.dispatchEvent(
                  new CustomEvent('host-nsfw-alert', {
                    detail: {
                      message: '⚠️ Explicit Content Detected on Camera / Screen',
                      subtext: `Your ${source.replace('_', ' ')} was automatically turned off to protect viewers.`,
                    },
                  })
                );
                if (source === 'camera') await localParticipant.setCameraEnabled(false);
                else await localParticipant.setScreenShareEnabled(false);
                api('/api/mod/report', { source, verdict: r.verdict, score: r.score, labels: r.detections.map((d) => d.label), latency_ms: r.ms, action: `${source} turned off` });
              }
            } else {
              strikes = 0;
              if (r.verdict === 'suggestive' && Date.now() - (lastWarn[source] || 0) > 30000) {
                lastWarn[source] = Date.now();
                api('/api/mod/report', { source, verdict: r.verdict, score: r.score, labels: r.detections.map((d) => d.label), latency_ms: r.ms, action: 'logged' });
              }
            }
          }
        } catch {}
        // adaptive pacing: never hog the GPU, ~2–3 scans/sec on a decent laptop
        timers.push(setTimeout(tick, 350));
      };
      timers.push(setTimeout(tick, 300));
      cleanups.push(() => { video.pause(); video.srcObject = null; });
    });

    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      cleanups.forEach((c) => c());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status.phase, trackKey, localParticipant]);

  const tone = !last ? '' : last.verdict === 'nude' ? 'bad' : last.verdict === 'suggestive' ? 'warn' : 'ok';

  return (
    <div className="card guard">
      <b>🛡 On-device AI guard</b>
      <span className="muted">NudeNet · TF.js</span>
      {status.phase === 'loading' && (
        <>
          <span className="muted">loading model {Math.round(status.progress * 100)}%</span>
          <div className="bar"><i style={{ width: `${status.progress * 100}%` }} /></div>
        </>
      )}
      {status.phase === 'error' && <span className="pill bad" title={status.error}>model failed — server AutoMod still active</span>}
      {status.phase === 'ready' && (
        <>
          <span className="pill ok"><span className="dot" />{localVideo.length ? `scanning ${localVideo.length} source${localVideo.length > 1 ? 's' : ''}` : 'idle (no video)'}</span>
          {last && <span className={`pill ${tone}`}>{last.verdict} · {last.ms}ms · {last.backend}</span>}
          <span className="muted mono">{scans} scans{status.from === 'cache' ? ' · model from cache' : ''}</span>
        </>
      )}
      <div className="grow" />
      <select className="input" style={{ width: 'auto', height: 32 }} value={quality} onChange={(e) => setQuality(+e.target.value)} title="Scan resolution">
        <option value={320}>Ultra Fast (320p)</option>
        <option value={384}>Balanced (384p)</option>
        <option value={480}>Accurate (480p)</option>
      </select>
      <label className="row" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); if (!e.target.checked) setStatus({ phase: 'off', progress: 0 }); }} /> on
      </label>
    </div>
  );
}
