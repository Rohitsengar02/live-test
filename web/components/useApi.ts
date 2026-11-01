'use client';
import { useCallback } from 'react';

/** fetch helper that attaches the LiveKit token so the server can verify who we are */
export function useApi(token: string) {
  return useCallback(
    async <T = unknown>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> => {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as T;
      return { ok: res.ok, status: res.status, data };
    },
    [token],
  );
}

export function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
