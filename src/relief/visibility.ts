import { simplifyXY, type XY } from '../geo/clip';
import type { Relief } from './relief';

/** A point of the flat map (mm) with its height above the middle elevation (mm). */
export type P3 = [number, number, number];

export interface Visibility {
  /** is this point of the terrain surface (or just above it) in view, rather than hidden behind a hill? */
  isVisible(x: number, y: number, z: number): boolean;
  /** is there terrain on the page at this point (within `r` mm of it)? Where there is none, it is sky. */
  covered(px: number, py: number, r?: number): boolean;
}

/** Depth-buffer pixels per mm of page. */
const MAX_CELLS = 5_000_000;
/** Slack for the buffer's sampling, in mm of depth: a point on the surface must not be judged hidden by it. */
const DEPTH_EPS_MM = 0.3;
/** Lines are tested at least this often along their length, mm on the page. */
const SAMPLE_MM = 0.25;
/** A stretch of line shorter than this, mm, is not worth drawing (it would be a speck). */
const MIN_RUN_MM = 0.45;

let cached: { relief: Relief; key: string; vis: Visibility } | undefined;

/**
 * Hidden-line removal: the terrain mesh is drawn into a depth buffer as seen from the camera, and a point counts as
 * visible if nothing nearer covers it. Built once per camera and reused while only styles change.
 */
export function buildVisibility(r: Relief): Visibility {
  const key = [r.frame.x, r.frame.y, r.frame.w, r.frame.h, r.surface.cols, r.surface.rows, r.camera.scale, r.camera.project(r.frame.x + 1, r.frame.y + 2, 3).join(','), r.camera.depth(r.frame.x + 1, r.frame.y + 2, 3), r.camera.depth(r.frame.x, r.frame.y + r.frame.h, 0)].join('|');
  if (cached && cached.relief.surface === r.surface && cached.key === key) return cached.vis;

  const { surface, camera, frame } = r;
  const { cols, rows } = surface;
  const sx = new Float32Array(cols * rows);
  const sy = new Float32Array(cols * rows);
  const sd = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = frame.x + i * surface.stepX;
    const y = frame.y + j * surface.stepY;
    const z = r.heightMm(surface.elev[j * cols + i]!);
    const [px, py] = camera.project(x, y, z);
    const k = j * cols + i;
    sx[k] = px; sy[k] = py; sd[k] = camera.depth(x, y, z);
  }

  const R = Math.min(6, Math.max(2, Math.sqrt(MAX_CELLS / (frame.w * frame.h))));
  const W = Math.ceil(frame.w * R) + 2;
  const H = Math.ceil(frame.h * R) + 2;
  const NONE = -1e9;
  const buf = new Float32Array(W * H).fill(NONE);

  const tri = (a: number, b: number, c: number) => {
    const ax = (sx[a]! - frame.x) * R, ay = (sy[a]! - frame.y) * R;
    const bx = (sx[b]! - frame.x) * R, by = (sy[b]! - frame.y) * R;
    const cx = (sx[c]! - frame.x) * R, cy = (sy[c]! - frame.y) * R;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const u0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const u1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const v0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const v1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    const da = sd[a]!, db = sd[b]!, dc = sd[c]!;
    const inv = 1 / area;
    const tol = -1e-3; // cover the hairline cracks between neighboring triangles
    for (let v = v0; v <= v1; v++) {
      const py = v + 0.5;
      for (let u = u0; u <= u1; u++) {
        const px = u + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const d = w0 * da + w1 * db + w2 * dc;
        const idx = v * W + u;
        if (d > buf[idx]!) buf[idx] = d;
      }
    }
  };
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    tri(a, b, c);
    tri(b, d, c);
  }

  const vis: Visibility = {
    covered(px, py, r = 0) {
      const u0 = Math.floor((px - r - frame.x) * R), u1 = Math.floor((px + r - frame.x) * R);
      const v0 = Math.floor((py - r - frame.y) * R), v1 = Math.floor((py + r - frame.y) * R);
      // outside the buffer there is no terrain; it counts as sky
      for (let v = Math.max(0, v0); v <= Math.min(H - 1, v1); v++) for (let u = Math.max(0, u0); u <= Math.min(W - 1, u1); u++) if (buf[v * W + u] !== NONE) return true;
      return false;
    },
    isVisible(x, y, z) {
      const [px, py] = camera.project(x, y, z);
      const u = Math.floor((px - frame.x) * R);
      const v = Math.floor((py - frame.y) * R);
      if (u < 0 || v < 0 || u >= W || v >= H) return true;
      const d = camera.depth(x, y, z);
      // the nearest and the farthest surface in the pixels around: where they differ a lot we are at an edge,
      // and sampling noise must not make a point on the surface look hidden
      let hi = NONE;
      let lo = Infinity;
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
        const uu = u + du, vv = v + dv;
        if (uu < 0 || vv < 0 || uu >= W || vv >= H) continue;
        const b = buf[vv * W + uu]!;
        if (b === NONE) continue;
        if (b > hi) hi = b;
        if (b < lo) lo = b;
      }
      if (hi === NONE) return true; // nothing was drawn here
      return d >= hi - DEPTH_EPS_MM - 0.5 * (hi - lo);
    },
  };
  cached = { relief: r, key, vis };
  return vis;
}

/**
 * The parts of 3D lines that can be seen, as page polylines. Each line is tested every quarter millimeter, the
 * ends of every cut are located more exactly, and flicker (a speck hidden or a speck visible) is smoothed away.
 */
export function visibleRuns(r: Relief, vis: Visibility, lines: P3[][]): XY[][] {
  const out: XY[][] = [];
  const project = (p: P3): XY => r.camera.project(p[0], p[1], p[2]);
  for (const line of lines) {
    if (line.length < 2) continue;
    // sample points along the line, close enough together on the page
    const pts: P3[] = [line[0]!];
    const pg: XY[] = [project(line[0]!)];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const pb = project(b);
      const n = Math.max(1, Math.ceil(Math.hypot(pb[0] - pg[pg.length - 1]![0], pb[1] - pg[pg.length - 1]![1]) / SAMPLE_MM));
      for (let k = 1; k < n; k++) { const t = k / n; const q: P3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; pts.push(q); pg.push(project(q)); }
      pts.push(b); pg.push(pb);
    }
    const flags = pts.map((p) => vis.isVisible(p[0], p[1], p[2]));
    // flicker: a single hidden sample inside visible ground is a sampling slip; a single visible one in hidden ground too
    for (let i = 1; i < flags.length - 1; i++) if (!flags[i] && flags[i - 1] && flags[i + 1]) flags[i] = true;
    for (let i = 1; i < flags.length - 1; i++) if (flags[i] && !flags[i - 1] && !flags[i + 1]) flags[i] = false;

    let run: XY[] = [];
    const flush = () => {
      if (run.length >= 2) {
        let len = 0;
        for (let k = 1; k < run.length; k++) len += Math.hypot(run[k]![0] - run[k - 1]![0], run[k]![1] - run[k - 1]![1]);
        if (len >= MIN_RUN_MM || (flags.every(Boolean) && len > 0)) out.push(simplifyXY(run, 0.04));
      }
      run = [];
    };
    // find the exact end of a cut between a visible and a hidden sample
    const edge = (a: P3, b: P3, aVisible: boolean): P3 => {
      let lo = a, hi = b;
      for (let it = 0; it < 4; it++) {
        const m: P3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        if (vis.isVisible(m[0], m[1], m[2]) === aVisible) lo = m; else hi = m;
      }
      return lo;
    };
    for (let i = 0; i < pts.length; i++) {
      if (flags[i]) {
        if (!run.length && i > 0 && !flags[i - 1]) run.push(project(edge(pts[i]!, pts[i - 1]!, true)));
        run.push(pg[i]!);
      } else if (run.length) {
        run.push(project(edge(pts[i - 1]!, pts[i]!, true)));
        flush();
      }
    }
    flush();
  }
  return out;
}
