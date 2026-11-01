'use client';
import { useEffect, useRef, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import { useApi } from './useApi';

type Msg = { id: string; ts: number; identity: string; name: string; role: string; text: string; masked?: boolean };
type Session = { token: string; identity: string; room: string; role: string };
type Verdict = { flags: string[]; model: string; latency_ms: number; cached?: boolean };

const dec = new TextDecoder();

export default function Chat({ session }: { session: Session }) {
  const api = useApi(session.token);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<Verdict | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const add = (m: Msg) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-200)));

  // history from the Valkey cache → late joiners see the conversation instantly
  useEffect(() => {
    fetch(`/api/chat?room=${encodeURIComponent(session.room)}`).then((r) => r.json()).then((d) => setMessages(d.messages || [])).catch(() => {});
  }, [session.room]);

  // live messages pushed by the server over LiveKit's data channel
  useDataChannel('chat', (packet) => {
    try {
      const d = JSON.parse(dec.decode(packet.payload));
      if (d.kind === 'message') add(d.message);
      else if (d.kind === 'delete') setMessages((p) => p.filter((m) => m.id !== d.id));
      else if (d.kind === 'clear') setMessages([]);
    } catch {}
  });

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError('');
    const r = await api<{ message?: Msg; reason?: string; verdict?: Verdict }>('/api/chat', { text: t });
    setSending(false);
    if (r.ok && r.data.message) {
      add(r.data.message);
      setLast(r.data.verdict ?? null);
      setText('');
    } else {
      setError(r.data.reason || 'message not sent');
      setLast(r.data.verdict ?? null);
    }
  };

  const del = (id: string) => api('/api/mod/action', { action: 'delete_message', messageId: id });

  return (
    <>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 20 }}>No messages yet — say hi 👋</div>}
        {messages.map((m) => (
          <div key={m.id} className="msg">
            {session.role === 'moderator' && <button className="btn sm danger del" onClick={() => del(m.id)}>Delete</button>}
            {m.role === 'host' && <span className="role">host</span>}
            <b style={{ color: m.identity === session.identity ? 'var(--accent)' : undefined }}>{m.name}</b>
            {m.text}
            {m.masked && <span className="masked">filtered</span>}
          </div>
        ))}
      </div>
      {error && <div className="chat-error">🛡 {error}</div>}
      {last && (
        <div className="muted mono" style={{ padding: '6px 12px 0' }}>
          checked by {last.model} in {last.latency_ms}ms{last.cached ? ' (cache hit)' : ''}
        </div>
      )}
      <form className="chat-form" onSubmit={send}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message…" maxLength={500} />
        <button className="btn primary" disabled={sending || !text.trim()}>Send</button>
      </form>
    </>
  );
}
