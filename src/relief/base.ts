import type { XY } from '../geo/clip';
import type { Relief } from './relief';

/**
 * A solid base under the 3D terrain, like a museum terrain model: the map is cut off at a floor below its lowest
 * point, and the sides that face the viewer are drawn as walls, with the terrain's own profile along their top.
 */
export type BaseFaces = 'plain' | 'strata' | 'strataHeavy' | 'hatch';

export interface BaseSettings {
  enabled: boolean;
  /** how far the floor is below the lowest point of the map, mm (before the view is fitted to the frame) */
  depthMm: number;
  /** what is drawn on the walls: nothing, a line at each contour level (or each heavy one), or upright hatching */
  faces: BaseFaces;
  /** mm between hatching lines, along the wall */
  hatchMm: number;
  /** pen for the base; unset = the contour pen */
  pen?: string;
}

export const defaultBase = (): BaseSettings => ({ enabled: false, depthMm: 12, faces: 'strata', hatchMm: 2 });

export interface BaseLines {
  /** the walls' outline: the terrain profile along their top, the floor edge, and the upright corners */
  outline: XY[][];
  /** strata or hatching on the walls */
  faces: XY[][];
}

/** A wall must turn at least this much toward the viewer to be drawn (edge-on walls are left out). */
const MIN_FACING = 0.03;

/** The floor's height (mm, the same scale as `heightMm`). */
export const floorZ = (r: Pick<Relief, 'heightMm' | 'surface'>, depthMm: number) => r.heightMm(r.surface.lo) - Math.max(0, depthMm);

interface Edge { nodes: number[]; nx: number; ny: number }

/**
 * The base's lines on the page. `levels` are the elevations (m) for strata, lowest first; they may go below the
 * map's lowest point, into the base.
 */
export function baseLines(r: Relief, s: BaseSettings, view: { turn: number; tilt: number }, levels: number[]): BaseLines {
  const out: BaseLines = { outline: [], faces: [] };
  const { surface, frame, camera } = r;
  const { cols, rows } = surface;
  const yaw = (view.turn * Math.PI) / 180;
  const st = Math.sin((Math.min(89, Math.max(0, view.tilt)) * Math.PI) / 180);
  if (st < 0.05) return out; // seen from straight above there are no walls to see
  // nearer the viewer is along (sin turn, cos turn) on the flat map, scaled by the tilt
  const facing = (nx: number, ny: number) => st * (Math.sin(yaw) * nx + Math.cos(yaw) * ny);

  const range = (n: number) => Array.from({ length: n }, (_, k) => k);
  const edges: Edge[] = [
    { nodes: range(cols).map((i) => (rows - 1) * cols + i), nx: 0, ny: 1 }, // south: the bottom of the map
    { nodes: range(cols).map((i) => i).reverse(), nx: 0, ny: -1 }, // north
    { nodes: range(rows).map((j) => j * cols).reverse(), nx: -1, ny: 0 }, // west
    { nodes: range(rows).map((j) => j * cols + cols - 1), nx: 1, ny: 0 }, // east
  ];
  const fz = floorZ(r, s.depthMm);
  const mmPerM = r.heightMm(1) - r.heightMm(0);
  const node = (k: number): [number, number, number] => {
    const i = k % cols;
    const j = (k - i) / cols;
    return [frame.x + i * surface.stepX, frame.y + j * surface.stepY, r.heightMm(surface.elev[k]!)];
  };
  const P = (x: number, y: number, z: number) => camera.project(x, y, z);
  const corners = new Set<string>();
  const upright = (x: number, y: number, top: number) => {
    const key = `${x.toFixed(3)},${y.toFixed(3)}`;
    if (corners.has(key)) return;
    corners.add(key);
    out.outline.push([P(x, y, fz), P(x, y, top)]);
  };

  for (const e of edges) {
    if (facing(e.nx, e.ny) < MIN_FACING) continue;
    const pts = e.nodes.map(node);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    out.outline.push(pts.map(([x, y, z]) => P(x, y, z)));
    out.outline.push([P(first[0], first[1], fz), P(last[0], last[1], fz)]);
    upright(first[0], first[1], first[2]);
    upright(last[0], last[1], last[2]);

    if (s.faces === 'hatch') {
      // upright lines every hatchMm along the wall, from the floor to the profile
      const len = Math.hypot(last[0] - first[0], last[1] - first[1]);
      const step = Math.max(0.5, s.hatchMm);
      for (let d = step; d < len - step * 0.5; d += step) {
        const t = (d / len) * (pts.length - 1);
        const k = Math.min(pts.length - 2, Math.floor(t));
        const f = t - k;
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f;
        const z = a[2] + (b[2] - a[2]) * f;
        out.faces.push([P(x, y, fz), P(x, y, z)]);
      }
    } else if (s.faces !== 'plain') {
      // a level line across the wall wherever the ground along the edge is higher than it
      for (const level of levels) {
        const zl = level * mmPerM + (r.heightMm(0));
        if (zl <= fz + 1e-6) continue;
        let run: XY[] = [];
        for (let k = 0; k < pts.length; k++) {
          const q = pts[k]!;
          const above = q[2] > zl;
          if (k > 0) {
            const p = pts[k - 1]!;
            if ((p[2] > zl) !== above) {
              const f = (zl - p[2]) / (q[2] - p[2]);
              run.push(P(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, zl));
              if (!above) { out.faces.push(run); run = []; }
            }
          }
          if (above) {
            if (!run.length) run.push(P(q[0], q[1], zl));
            else if (k === pts.length - 1) run.push(P(q[0], q[1], zl));
          }
        }
        if (run.length >= 2) out.faces.push(run);
      }
    }
  }
  return out;
}

/** The levels for strata, every `stepM` meters, from just above the floor up to the map's highest point. */
export function strataLevels(r: Pick<Relief, 'heightMm' | 'surface'>, depthMm: number, stepM: number): number[] {
  if (!(stepM > 0)) return [];
  const mmPerM = r.heightMm(1) - r.heightMm(0);
  const floorM = r.surface.lo - Math.max(0, depthMm) / mmPerM;
  const out: number[] = [];
  for (let l = Math.floor(floorM / stepM) * stepM + stepM; l < r.surface.hi && out.length < 2000; l += stepM) out.push(l);
  return out;
}
