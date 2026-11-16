import { PREFIX } from './projects';
import { newShareToken } from './share';

/**
 * A short-lived relay for places read from photos on a phone. The photo never comes here: the phone reads the place it
 * was taken (latitude, longitude, time) from the photo's own metadata, and posts just that. The page that showed the QR
 * code asks for them. Kept under `hike/photo/` for 15 minutes after the last post, then refused and deleted, and each
 * new session clears the expired ones. The token (16 characters from 31, about 80 bits) is the only key.
 *
 *   POST   /api/photo                 -> { token, expiresAt }          start a session (the page with the QR code)
 *   POST   /api/photo/<token>         body { places: [...] }           the phone adds places
 *   GET    /api/photo/<token>         -> { places, expiresAt }         the page collects them
 *   DELETE /api/photo/<token>                                           the page is done
 */
export const PHOTO_PREFIX = PREFIX + 'photo/';
export const PHOTO_TTL_MS = 15 * 60 * 1000;
export const MAX_PLACES = 20;
export const MAX_BODY_BYTES = 16 * 1024;
const TOKEN = /^[2-9a-hjkmnp-z]{16}$/;

export interface Place { name: string; lat: number; lon: number; takenAt?: string }

export interface PhotoBucket {
  get(key: string): Promise<{ text(): Promise<string>; uploaded: Date } | null>;
  put(key: string, value: string, opts?: { httpMetadata?: { contentType: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
  list?(opts: { prefix: string; limit?: number }): Promise<{ objects: { key: string; uploaded: Date }[] }>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** A place as the phone sent it, cleaned: or undefined if it is not usable. */
export function cleanPlace(raw: unknown): Place | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.lat === 'number' ? r.lat : NaN;
  const lon = typeof r.lon === 'number' ? r.lon : NaN;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return undefined;
  const name = (typeof r.name === 'string' ? r.name : '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'Photo';
  const out: Place = { name, lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  if (typeof r.takenAt === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)?$/.test(r.takenAt)) out.takenAt = r.takenAt;
  return out;
}

async function sweep(bucket: PhotoBucket, now: number): Promise<void> {
  if (!bucket.list) return;
  const { objects } = await bucket.list({ prefix: PHOTO_PREFIX, limit: 100 });
  const old = objects.filter((o) => now - o.uploaded.getTime() >= PHOTO_TTL_MS).map((o) => o.key);
  if (old.length) await bucket.delete(old);
}

export async function handlePhoto(req: Request, bucket: PhotoBucket | undefined, now = Date.now(), random?: (n: number) => Uint8Array): Promise<Response | null> {
  const m = /^\/api\/photo(?:\/([^/]+))?\/?$/.exec(new URL(req.url).pathname);
  if (!m) return null;
  if (!bucket) return json(503, { error: 'photos are not set up on this server' });

  if (m[1] === undefined) {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const token = newShareToken(random);
    await bucket.put(`${PHOTO_PREFIX}${token}.json`, JSON.stringify({ places: [] }), { httpMetadata: { contentType: 'application/json' } });
    await sweep(bucket, now).catch(() => {});
    return json(200, { token, expiresAt: now + PHOTO_TTL_MS });
  }

  const token = decodeURIComponent(m[1]).toLowerCase();
  if (!TOKEN.test(token)) return json(400, { error: 'bad link' });
  const key = `${PHOTO_PREFIX}${token}.json`;
  const found = await bucket.get(key);
  if (!found) return json(404, { error: 'no such session' });
  if (now - found.uploaded.getTime() >= PHOTO_TTL_MS) { await bucket.delete(key); return json(404, { error: 'this session has expired' }); }
  let places: Place[] = [];
  try { places = (JSON.parse(await found.text()) as { places: Place[] }).places ?? []; } catch { places = []; }

  if (req.method === 'GET') return json(200, { places, expiresAt: found.uploaded.getTime() + PHOTO_TTL_MS });
  if (req.method === 'DELETE') { await bucket.delete(key); return json(200, { ok: true }); }
  if (req.method !== 'POST') return json(405, { error: 'GET, POST or DELETE' });

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'too large' });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { error: 'too large' });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); }
  const sent = Array.isArray((body as { places?: unknown })?.places) ? (body as { places: unknown[] }).places : null;
  if (!sent) return json(400, { error: 'send { places: [...] }' });
  const added = sent.map(cleanPlace).filter((p): p is Place => p !== undefined);
  if (!added.length) return json(400, { error: 'no usable places' });
  const all = [...places, ...added].slice(0, MAX_PLACES);
  await bucket.put(key, JSON.stringify({ places: all }), { httpMetadata: { contentType: 'application/json' } });
  return json(200, { added: all.length - places.length });
}
