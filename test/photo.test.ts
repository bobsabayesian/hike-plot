import { describe, expect, it } from 'vitest';
import { nameFromFile, placeFromTags, readPhotoData, showTaken } from '../src/photo/exif';
import { cleanPlace, handlePhoto, MAX_PLACES, PHOTO_TTL_MS, type PhotoBucket } from '../worker/photo';
import { qrSvg } from '../src/ui/PhotoPlaces';
import { phoneUrl } from '../src/photo/session';

/** A JPEG that holds only an EXIF block: a date, and a GPS position (46°51'07.2" N, 121°45'36" W). */
function jpegWithGps(withGps = true): Uint8Array {
  const b: number[] = [];
  const u16 = (n: number) => b.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => b.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const ascii = (t: string) => { for (const c of t) b.push(c.charCodeAt(0)); b.push(0); };
  const entry = (tag: number, type: number, count: number, value: () => void) => { u16(tag); u16(type); u32(count); value(); };
  b.push(0x4d, 0x4d); u16(42); u32(8); // big-endian TIFF header; first IFD at 8
  // IFD0 at 8: EXIF pointer and (optionally) GPS pointer
  const n0 = withGps ? 2 : 1;
  u16(n0);
  entry(0x8769, 4, 1, () => u32(8 + 2 + n0 * 12 + 4));
  const exifAt = 8 + 2 + n0 * 12 + 4;
  const gpsAt = exifAt + 2 + 12 + 4;
  if (withGps) entry(0x8825, 4, 1, () => u32(gpsAt));
  u32(0);
  // EXIF IFD: DateTimeOriginal
  const dtAt = withGps ? gpsAt + 2 + 4 * 12 + 4 : gpsAt;
  u16(1); entry(0x9003, 2, 20, () => u32(dtAt)); u32(0);
  if (withGps) {
    const latAt = dtAt + 20, lonAt = latAt + 24;
    u16(4);
    entry(1, 2, 2, () => b.push(0x4e, 0, 0, 0)); // N
    entry(2, 5, 3, () => u32(latAt));
    entry(3, 2, 2, () => b.push(0x57, 0, 0, 0)); // W
    entry(4, 5, 3, () => u32(lonAt));
    u32(0);
  }
  ascii('2024:07:04 10:32:05'); // 19 characters and the terminating zero
  if (withGps) for (const [n, d] of ([[46, 1], [51, 1], [72, 10], [121, 1], [45, 1], [36, 1]] as [number, number][])) { u32(n); u32(d); }
  const tiff = b;
  const len = 2 + 6 + tiff.length;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 255, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9]);
}

describe('reading a place from a photo', () => {
  it('reads the position and the time from a real EXIF block', async () => {
    const r = await readPhotoData(jpegWithGps(), 'IMG_0042.JPG');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.place.name).toBe('IMG_0042');
    expect(r.place.lat).toBeCloseTo(46.852, 5);
    expect(r.place.lon).toBeCloseTo(-121.76, 5);
    expect(r.place.takenAt).toBe('2024-07-04T10:32:05');
    expect(showTaken(r.place.takenAt)).toContain('2024');
  });
  it('says so when the photo has no location, or is not a photo', async () => {
    const none = await readPhotoData(jpegWithGps(false), 'a.jpg');
    expect(none).toMatchObject({ ok: false });
    if (!none.ok) expect(none.reason).toMatch(/no location/);
    expect(await readPhotoData(new Uint8Array([1, 2, 3, 4]), 'notes.txt')).toMatchObject({ ok: false, name: 'notes' });
  });
  it('rejects empty and out-of-range positions, and names a place from its file', () => {
    expect(placeFromTags('x.jpg', { latitude: 0, longitude: 0 })).toMatchObject({ ok: false });
    expect(placeFromTags('x.jpg', { latitude: 95, longitude: 10 })).toMatchObject({ ok: false });
    expect(placeFromTags('x.jpg', undefined)).toMatchObject({ ok: false });
    expect(placeFromTags('x.jpg', { latitude: 1.23456789, longitude: -2 })).toMatchObject({ ok: true, place: { lat: 1.234568, lon: -2 } });
    expect(nameFromFile('Trip 4/IMG.final.HEIC')).toBe('IMG.final');
    expect(nameFromFile('.jpg')).toBe('Photo');
  });
});

describe('the phone relay', () => {
  const store = () => {
    const m = new Map<string, { text: string; uploaded: Date }>();
    const bucket: PhotoBucket = {
      get: async (k) => { const v = m.get(k); return v ? { text: async () => v.text, uploaded: v.uploaded } : null; },
      put: async (k, v) => { m.set(k, { text: String(v), uploaded: new Date(now) }); },
      delete: async (ks) => { for (const k of [ks].flat()) m.delete(k); },
      list: async ({ prefix }) => ({ objects: [...m].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, uploaded: v.uploaded })) }),
    };
    return { m, bucket };
  };
  let now = 1_700_000_000_000;
  const call = async (b: PhotoBucket, method: string, path: string, body?: unknown) =>
    (await handlePhoto(new Request(`https://x.test${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), b, now))!;

  it('a session collects what the phone posts, in order, and can be ended', async () => {
    const { bucket } = store();
    const { token } = await (await call(bucket, 'POST', '/api/photo')).json() as { token: string };
    expect(token).toMatch(/^[2-9a-hjkmnp-z]{16}$/);
    expect((await (await call(bucket, 'GET', `/api/photo/${token}`)).json() as { places: unknown[] }).places).toEqual([]);
    const posted = await call(bucket, 'POST', `/api/photo/${token}`, { places: [{ name: 'IMG_1', lat: 46.85, lon: -121.76, takenAt: '2024-07-04T10:32:05' }, { name: 'bad', lat: 999, lon: 0 }] });
    expect(await posted.json()).toEqual({ added: 1 });
    await call(bucket, 'POST', `/api/photo/${token}`, { places: [{ name: 'IMG_2', lat: 1, lon: 2 }] });
    const got = await (await call(bucket, 'GET', `/api/photo/${token}`)).json() as { places: { name: string }[] };
    expect(got.places.map((p) => p.name)).toEqual(['IMG_1', 'IMG_2']);
    expect((await call(bucket, 'DELETE', `/api/photo/${token}`)).status).toBe(200);
    expect((await call(bucket, 'GET', `/api/photo/${token}`)).status).toBe(404);
  });
  it('refuses a made-up or unknown token, nonsense bodies and too many places', async () => {
    const { bucket } = store();
    expect((await call(bucket, 'GET', '/api/photo/short')).status).toBe(400);
    expect((await call(bucket, 'GET', '/api/photo/abcdefghjkmnpqrs')).status).toBe(404);
    const { token } = await (await call(bucket, 'POST', '/api/photo')).json() as { token: string };
    expect((await call(bucket, 'POST', `/api/photo/${token}`, { nope: 1 })).status).toBe(400);
    expect((await call(bucket, 'POST', `/api/photo/${token}`, { places: [{ lat: 'x' }] })).status).toBe(400);
    const many = Array.from({ length: MAX_PLACES + 5 }, (_, i) => ({ name: `p${i}`, lat: 1, lon: 1 }));
    await call(bucket, 'POST', `/api/photo/${token}`, { places: many });
    expect((await (await call(bucket, 'GET', `/api/photo/${token}`)).json() as { places: unknown[] }).places).toHaveLength(MAX_PLACES);
    expect((await call(bucket, 'PUT', `/api/photo/${token}`)).status).toBe(405);
  });
  it('a session expires 15 minutes after its last post, and a new session clears old ones', async () => {
    const { bucket, m } = store();
    const { token } = await (await call(bucket, 'POST', '/api/photo')).json() as { token: string };
    now += PHOTO_TTL_MS - 1000;
    expect((await call(bucket, 'GET', `/api/photo/${token}`)).status).toBe(200);
    now += 2000;
    expect((await call(bucket, 'GET', `/api/photo/${token}`)).status).toBe(404);
    expect(m.size).toBe(0);
    await call(bucket, 'POST', '/api/photo');
    now += PHOTO_TTL_MS + 1;
    await call(bucket, 'POST', '/api/photo');
    expect(m.size).toBe(1);
  });
  it('does not serve other paths, and cleans what the phone sends', async () => {
    expect(await handlePhoto(new Request('https://x.test/api/other'), undefined)).toBeNull();
    expect(cleanPlace({ name: '<b>Hi</b>\u0001', lat: 1.23456789, lon: 2, takenAt: 'yesterday' })).toEqual({ name: 'bHi/b', lat: 1.234568, lon: 2 });
    expect(cleanPlace({ name: '', lat: 1, lon: 2 })?.name).toBe('Photo');
  });
});

describe('the QR code', () => {
  it('is an SVG for the phone page address', () => {
    const url = phoneUrl('abcdefghjkmnpqrs', 'https://hike.example');
    expect(url).toBe('https://hike.example/phone?s=abcdefghjkmnpqrs');
    expect(qrSvg(url)).toMatch(/^<svg/);
  });
});
