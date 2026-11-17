import type { Rect, XY } from '../geo/clip';

/** The view: how far the map is turned, tipped back, and how strongly distance makes things smaller. */
export interface ViewSettings {
  /** degrees around the vertical axis */
  turn: number;
  /** degrees: 0 looks straight down (the flat map), 90 looks from the side */
  tilt: number;
  /** 0 = none; 100 = a close camera (strong foreshortening) */
  perspective: number;
  /** percent: above 100 the view is enlarged past the frame (and trimmed at its edges); unset = 100 */
  zoom?: number;
}

export interface Camera {
  /** a point on the flat map (mm) and its height above the middle elevation (mm) -> where it lands on the page */
  project(x: number, y: number, z: number): XY;
  /** how near the viewer a point is (bigger = nearer), for hiding what is behind a ridge */
  depth(x: number, y: number, z: number): number;
  /** the page scale applied to fit the view inside the frame (never more than 1), times the zoom */
  scale: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Turns the map about its center, tips it back, applies perspective, then shrinks and centers the whole thing inside
 * `frame` (it is never enlarged). `corners` are points on the map's edge that must stay in the frame: the surface
 * nodes as (x, y, z) mm. With no turn, no tilt and no perspective this does nothing at all.
 *
 * With a zoom above 100% the fitted view is enlarged by that much and runs past the frame. It is then centered on
 * `focus` (e.g. the route's points), but never so far that the frame would show past the edge of the map.
 */
export function makeCamera(frame: Rect, view: ViewSettings, corners: [number, number, number][], focus?: [number, number, number][]): Camera {
  const yaw = rad(view.turn);
  const tilt = rad(Math.min(89, Math.max(0, view.tilt)));
  const [c, s, ct, st] = [Math.cos(yaw), Math.sin(yaw), Math.cos(tilt), Math.sin(tilt)];
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;

  const rotate = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const tx = c * dx - s * dy;
    const ty = s * dx + c * dy;
    return [tx, ct * ty - st * z, st * ty + ct * z];
  };

  const pts = corners.map(([x, y, z]) => rotate(x, y, z));
  const span = Math.max(frame.w, frame.h);
  const nearest = pts.reduce((m, p) => Math.max(m, p[2]), 0);
  const persp = Math.min(100, Math.max(0, view.perspective));
  const distance = persp > 0 ? (Math.max(span * 1.5, nearest + span * 0.75) * 100) / persp : Infinity;
  const zoomAt = (z: number) => (Number.isFinite(distance) ? distance / (distance - z) : 1);
  const view2 = (p: [number, number, number]): XY => { const k = zoomAt(p[2]); return [p[0] * k, p[1] * k]; };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    const [x, y] = view2(p);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const zoom = Math.max(1, (view.zoom ?? 100) / 100);
  const scale = Math.min(1, frame.w / Math.max(1e-6, maxX - minX), frame.h / Math.max(1e-6, maxY - minY)) * zoom;
  let mx = (minX + maxX) / 2;
  let my = (minY + maxY) / 2;
  if (zoom > 1 && focus?.length) {
    let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity;
    for (const q of focus) {
      const [x, y] = view2(rotate(q[0], q[1], q[2]));
      fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y);
    }
    // the frame's half size in view units; the center may move only as far as the map still fills the frame
    const hw = frame.w / 2 / scale;
    const hh = frame.h / 2 / scale;
    const hold = (want: number, lo: number, hi: number, half: number) => (hi - lo >= 2 * half ? Math.min(hi - half, Math.max(lo + half, want)) : (lo + hi) / 2);
    mx = hold((fx0 + fx1) / 2, minX, maxX, hw);
    my = hold((fy0 + fy1) / 2, minY, maxY, hh);
  }

  return {
    scale,
    project(x, y, z) {
      const [px, py] = view2(rotate(x, y, z));
      return [cx + (px - mx) * scale, cy + (py - my) * scale];
    },
    depth: (x, y, z) => rotate(x, y, z)[2],
  };
}
