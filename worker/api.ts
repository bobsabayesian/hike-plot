/** Shared by the Cloudflare Worker (production) and the Vite dev server (local). */
const UA = 'hike-plot/0.1 (https://hike.bobsabayesian.io)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600, s-maxage=86400' },
  });

const num = (v: string | null) => (v !== null && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined);

export async function handleApi(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(req);
  if (hit) return hit;

  let res: Response;
  try {
    res = await route(url);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'upstream failure' }, 502);
  }
  if (res.ok) await cache?.put(req, res.clone());
  return res;
}

async function route(url: URL): Promise<Response> {
  switch (url.pathname) {
    case '/api/geocode': {
      const q = url.searchParams.get('q')?.trim();
      if (!q || q.length > 200) return json({ error: 'missing q' }, 400);
      const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
      if (!r.ok) return json({ error: 'geocoder unavailable' }, 502);
      const [hit] = (await r.json()) as any[];
      if (!hit) return json({ error: 'not found' }, 404);
      const [s, n, w, e] = hit.boundingbox.map(Number) as number[];
      const parts = String(hit.display_name).split(', ');
      return json({
        name: hit.name || parts[0],
        location: parts.slice(1, 3).join(', '),
        lat: +hit.lat, lon: +hit.lon,
        bbox: { minLat: s, maxLat: n, minLon: w, maxLon: e },
        kind: hit.type,
      });
    }
    case '/api/reverse': {
      const lat = num(url.searchParams.get('lat'));
      const lon = num(url.searchParams.get('lon'));
      if (lat === undefined || lon === undefined) return json({ error: 'missing lat/lon' }, 400);
      const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`, { headers: { 'user-agent': UA } });
      if (!r.ok) return json({ error: 'geocoder unavailable' }, 502);
      const d = (await r.json()) as any;
      const a = d.address ?? {};
      const place = a.county ?? a.city ?? a.town ?? a.state_district ?? a.municipality;
      const region = a.state ?? a.country;
      return json({ location: [place, region].filter(Boolean).join(', ') });
    }
    case '/api/peaks': {
      const [s, n, w, e] = ['minLat', 'maxLat', 'minLon', 'maxLon'].map((k) => num(url.searchParams.get(k)));
      if ([s, n, w, e].some((v) => v === undefined)) return json({ error: 'missing bbox' }, 400);
      if ((n! - s!) > 1 || (e! - w!) > 1) return json({ error: 'bbox too large' }, 400);
      const query = `[out:json][timeout:15];node["natural"="peak"]["name"](${s},${w},${n},${e});out body 100;`;
      const r = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!r.ok) return json({ error: 'overpass unavailable' }, 502);
      const d = (await r.json()) as any;
      return json({
        peaks: (d.elements ?? []).map((x: any) => ({ name: x.tags.name, lat: x.lat, lon: x.lon, ele: num(x.tags.ele ?? null) })),
      });
    }
    default:
      return json({ error: 'not found' }, 404);
  }
}
