import type { Metadata, Viewport } from 'next';
import '@livekit/components-styles';
import './globals.css';

export const metadata: Metadata = {
  title: 'StreamGuard — open-source live streaming with AI moderation',
  description: 'Next.js + LiveKit + NudeNet + toxic-bert. Real-time chat, live video, screen share and moderation — fully free and self-hosted.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0d12' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
