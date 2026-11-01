import RoomClient from '@/components/RoomClient';

export default async function RoomPage({ params, searchParams }: {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ role?: string; name?: string }>;
}) {
  const { room } = await params;
  const sp = await searchParams;
  const role = sp.role === 'host' || sp.role === 'moderator' ? sp.role : 'viewer';
  return <RoomClient room={decodeURIComponent(room)} role={role} initialName={sp.name || ''} />;
}
