import { flattenPath } from '../export/offset';

/**
 * Handwriting from the owner's service (set up on the admin page): the Worker fetches single-line SVG text for us and we read the
 * strokes out of it. Compose is synchronous, so the strokes come from a cache; a miss starts the fetch and the app re-composes when it lands.
 */

export interface InkRequest { text: string; sizeMm: number; font: string; preset: string; seed: number }
/** strokes in mm, origin at the ink's top-left corner */
export interface Ink { widthMm: number; heightMm: number; strokes: [number, number][][]; missing: string }

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
/** a transform attribute: translate, scale and matrix (what a group in the service's file uses) */
function transformOf(attr: string | undefined): Mat {
  let m = ID;
  for (const t of attr?.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g) ?? []) {
    const a = t[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some(Number.isNaN)) continue;
    if (t[1] === 'translate') m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (t[1] === 'scale') m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (a.length === 6) m = mul(m, a as Mat);
  }
  return m;
}
const attrOf = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)?.slice(2).find((v) => v !== undefined);

/** Read the strokes out of the service's SVG (its viewBox is in mm). Undefined if it holds no strokes. */
export function parseInkSvg(svg: string, missing = ''): Ink | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!root) return undefined;
  const vb = attrOf(root, 'viewBox')?.split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return undefined;
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const strokes: [number, number][][] = [];
  const stack: Mat[] = [ID];
  for (const m of svg.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, rest, selfClose] = m;
    const here = stack[stack.length - 1]!;
    if (name === 'g') {
      if (close) { if (stack.length > 1) stack.pop(); } else if (!selfClose) stack.push(mul(here, transformOf(attrOf(rest!, 'transform'))));
    } else if (!close) {
      const d = attrOf(rest!, 'd');
      if (!d) continue;
      const mat = mul(here, transformOf(attrOf(rest!, 'transform')));
      for (const sub of flattenPath(d)) {
        const pts = sub.pts.map(([x, y]) => [mat[0] * x + mat[2] * y + mat[4] - vx, mat[1] * x + mat[3] * y + mat[5] - vy] as [number, number]);
        if (sub.closed && pts.length) pts.push(pts[0]!);
        if (pts.length > 1) strokes.push(pts);
      }
    }
  }
  return strokes.length ? { widthMm: vw, heightMm: vh, strokes, missing } : undefined;
}

export const inkKey = (r: InkRequest) => JSON.stringify([r.text, r.sizeMm, r.font, r.preset, r.seed]);

const cache = new Map<string, Ink | { error: string } | 'loading'>();
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };
/** for useSyncExternalStore: changes whenever a fetch finishes */
export const subscribeInk = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const inkVersion = () => version;

/** The strokes if they are here; otherwise start getting them. `error` says why they cannot be had (service off, token refused). */
export function inkFor(r: InkRequest): { ink?: Ink; error?: string; loading?: boolean } {
  const key = inkKey(r);
  const hit = cache.get(key);
  if (hit === 'loading') return { loading: true };
  if (hit) return 'error' in hit ? { error: hit.error } : { ink: hit };
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return { error: 'offline' };
  cache.set(key, 'loading');
  const q = new URLSearchParams({ text: r.text, size: String(r.sizeMm), font: r.font, seed: String(r.seed) });
  if (r.preset !== 'project') q.set('preset', r.preset);
  void (async () => {
    try {
      const res = await fetch(`/api/handwriter/text?${q}`);
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        cache.set(key, { error: msg ?? `The handwriting service answered ${res.status}.` });
      } else {
        const ink = parseInkSvg(await res.text(), res.headers.get('x-handwriter-missing') ?? '');
        cache.set(key, ink ?? { error: 'The service drew nothing for that text.' });
      }
    } catch {
      cache.set(key, { error: 'Could not reach the handwriting service.' });
    }
    bump();
  })();
  return { loading: true };
}

let status: Promise<boolean> | undefined;
/** Is a handwriting service set up on this site? (asked once) */
export function handwriterEnabled(): Promise<boolean> {
  status ??= fetch('/api/handwriter/status').then((r) => r.json()).then((j: { enabled?: boolean }) => !!j.enabled).catch(() => false);
  return status;
}

/** put strokes in the cache by hand (tests) */
export function primeInk(r: InkRequest, ink: Ink) { cache.set(inkKey(r), ink); }
