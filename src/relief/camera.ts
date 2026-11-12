import type { Rect, XY } from '../geo/clip';

/** The view: how far the map is turned, tipped back, and how strongly distance makes things smaller. */
export interface ViewSettings {
  /** degrees around the vertical axis */
  turn: number;
  /** degrees: 0 looks straight down (the flat map), 90 looks from the side */
  tilt: number;
  /** 0 = none; 100 = a close camera (strong foreshortening) */
  perspective: number;
}

export interface Camera {
  /** a point on the flat map (mm) and its height above the middle elevation (mm) -> where it lands on the page */
  project(x: number, y: number, z: number): XY;
  /** how near the viewer a point is (bigger = nearer), for hiding what is behind a ridge */
  depth(x: number, y: number, z: number): number;
  /** the page scale applied to fit the view inside the frame (never more than 1) */
  scale: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Turns the map about its center, tips it back, applies perspective, then shrinks and centers the whole thing inside
 * `frame` (it is never enlarged). `corners` are points on the map's edge that must stay in the frame: the surface
 * nodes as (x, y, z) mm. With no turn, no tilt and no perspective this does nothing at all.
 */
export function makeCamera(frame: Rect, view: ViewSettings, corners: [number, number, number][]): Camera {
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
  const scale = Math.min(1, frame.w / Math.max(1e-6, maxX - minX), frame.h / Math.max(1e-6, maxY - minY));
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;

  return {
    scale,
    project(x, y, z) {
      const [px, py] = view2(rotate(x, y, z));
      return [cx + (px - mx) * scale, cy + (py - my) * scale];
    },
    depth: (x, y, z) => rotate(x, y, z)[2],
  };
}
