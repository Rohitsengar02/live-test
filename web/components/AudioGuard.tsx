'use client';
import { useEffect, useRef } from 'react';
import { useApi } from './useApi';

// Browser Web Speech Recognition interface
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: Event) => void;
  onend: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export default function AudioGuard({ token, enabled = true }: { token: string; enabled?: boolean }) {
  const api = useApi(token);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[AudioGuard] Speech recognition is not supported in this browser.');
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = async (event: SpeechRecognitionEvent) => {
      for (let i = event.results.length - 1; i >= 0; i--) {
        const res = event.results[i];
        if (res.isFinal && res[0]?.transcript) {
          const phrase = res[0].transcript.trim();
          if (phrase) {
            try {
              await api('/api/speech', { text: phrase });
            } catch (err) {
              console.error('[AudioGuard] Speech moderation check failed', err);
            }
          }
        }
      }
    };

    rec.onerror = (e) => {
      // Ignore normal silence/no-speech events
      console.warn('[AudioGuard] Speech recognition event:', e);
    };

    rec.onend = () => {
      if (isRunningRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };

    try {
      rec.start();
      isRunningRef.current = true;
      recognitionRef.current = rec;
    } catch (e) {
      console.warn('[AudioGuard] Could not start speech recognition:', e);
    }

    return () => {
      isRunningRef.current = false;
      try {
        rec.stop();
      } catch {}
      recognitionRef.current = null;
    };
  }, [enabled, api]);

  return null;
}

