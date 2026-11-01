import { handle, HttpError, MODERATOR_URL } from '@/lib/server';

// Test bench: proxy an uploaded image to the server-side NudeNet (Python/ONNX).
export const POST = handle(async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(400, 'file required');
  if (file.size > 8 * 1024 * 1024) throw new HttpError(413, 'max 8 MB');
  const fd = new FormData();
  fd.append('file', file, 'upload');
  const t0 = performance.now();
  const res = await fetch(`${MODERATOR_URL}/moderate/image`, { method: 'POST', body: fd, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, 'moderation service unreachable — is the moderator container running?');
  return Response.json({ ...(await res.json()), roundtrip_ms: Math.round(performance.now() - t0) });
});
