import type { PhotoPlace } from './exif';

/** The phone relay: start a session, and collect the places the phone posts to it. */
export async function startPhotoSession(): Promise<{ token: string; expiresAt: number }> {
  const r = await fetch('/api/photo', { method: 'POST' });
  const body = (await r.json().catch(() => ({}))) as { token?: string; expiresAt?: number; error?: string };
  if (!r.ok || !body.token) throw new Error(body.error ?? 'Could not start a phone session');
  return { token: body.token, expiresAt: body.expiresAt ?? Date.now() + 15 * 60 * 1000 };
}

export async function collectPlaces(token: string): Promise<{ places: PhotoPlace[]; expired: boolean }> {
  const r = await fetch(`/api/photo/${token}`, { cache: 'no-store' });
  if (r.status === 404) return { places: [], expired: true };
  if (!r.ok) throw new Error('Could not check for photos');
  const body = (await r.json()) as { places?: PhotoPlace[] };
  return { places: body.places ?? [], expired: false };
}

export async function endPhotoSession(token: string): Promise<void> {
  try { await fetch(`/api/photo/${token}`, { method: 'DELETE' }); } catch { /* it expires by itself */ }
}

/** The address the QR code opens on the phone. */
export const phoneUrl = (token: string, origin = location.origin) => `${origin}/phone?s=${token}`;
