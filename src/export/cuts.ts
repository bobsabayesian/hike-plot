import type { XY } from '../geo/clip';
import { cutNearPolylines } from '../features/halo';
import { effectiveCuts, layerOfPart, type LayerSettings } from '../scene/layers';
import type { PathPrim, Scene } from '../scene/types';
import { flattenPath } from './offset';

const f = (n: number) => +n.toFixed(3);
const toD = (lines: XY[][]): string => lines.map((l) => l.map((q, i) => `${i ? 'L' : 'M'}${f(q[0])} ${f(q[1])}`).join('')).join('');

/** The polylines a path draws (a closed shape comes back round to where it began, so a cut near its start does not miss the join). */
function linesOf(d: string): XY[][] {
  return flattenPath(d).filter((s) => s.pts.length >= 2).map((s) => (s.closed ? [...s.pts, s.pts[0]!] : s.pts) as XY[]);
}

/** Cutting samples a line every 0.25 mm near a cutter; points that add nothing (on a straight run, within 2 microns) are dropped again so a cut file is not much larger. */
const FLAT_MM = 0.002;
function tidy(line: XY[]): XY[] {
  if (line.length < 3) return line;
  const out: XY[] = [line[0]!];
  for (let i = 1; i < line.length - 1; i++) {
    const a = out[out.length - 1]!, b = line[i]!, c = line[i + 1]!;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const l = Math.hypot(dx, dy);
    const off = l ? Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / l : Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (off > FLAT_MM) out.push(b);
  }
  out.push(line[line.length - 1]!);
  return out;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxOf = (lines: XY[][]): Box => {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const l of lines) for (const [x, y] of l) { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  return b;
};
const near = (a: Box, b: Box, r: number) => a.x0 <= b.x1 + r && a.x1 >= b.x0 - r && a.y0 <= b.y1 + r && a.y1 >= b.y0 - r;

/**
 * Cut the layers of a prepared plotter scene by each other, as the layer settings say. A layer's rule lists layers beneath it:
 * wherever the upper layer has drawn something (its lines as the pen lays them, half a line wide) plus the rule's gap, the lines
 * of the layers it cuts are taken away. The stack is worked from the top down, so a layer is cut by the layers above it before it
 * cuts others: what remains of it is what clears the ones below. Primitives with no part are never cut and never cut.
 */
export function applyCuts(scene: Scene, layers: LayerSettings): Scene {
  if (!Object.keys(layers.rules).length) return scene;
  const layerAt = scene.prims.map((p) => layerOfPart(p.part));
  /** each path's lines as they stand now (flattened on first need), and the ones cut since */
  const current = new Map<number, XY[][]>();
  const cutIdx = new Set<number>();
  const linesAt = (i: number): XY[][] => { let l = current.get(i); if (!l) { l = linesOf((scene.prims[i] as PathPrim).d); current.set(i, l); } return l; };
  const dropped = new Set<number>();
  const isInk = (i: number) => scene.prims[i]!.kind === 'path' && (scene.prims[i] as PathPrim).mode === 'stroke' && !dropped.has(i);

  for (const upper of [...layers.order].reverse()) {
    const rule = layers.rules[upper];
    if (!rule) continue;
    const targets = effectiveCuts(layers, upper);
    if (!targets.length) continue;
    // the upper layer's lines, grouped by how far each reaches (half its line plus the gap)
    const reach = new Map<number, { r: number; lines: XY[][]; box: Box }>();
    for (let i = 0; i < scene.prims.length; i++) {
      if (layerAt[i] !== upper || !isInk(i)) continue;
      const lines = linesAt(i);
      if (!lines.length) continue;
      const r = ((scene.prims[i] as PathPrim).widthMm ?? 0.5) / 2 + rule.gapMm;
      const k = Math.round(r / 0.05);
      const g = reach.get(k) ?? { r: k * 0.05, lines: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
      g.lines.push(...lines);
      const b = boxOf(lines);
      g.box = { x0: Math.min(g.box.x0, b.x0), y0: Math.min(g.box.y0, b.y0), x1: Math.max(g.box.x1, b.x1), y1: Math.max(g.box.y1, b.y1) };
      reach.set(k, g);
    }
    if (!reach.size) continue;
    for (let i = 0; i < scene.prims.length; i++) {
      const lay = layerAt[i];
      if (lay === undefined || !targets.includes(lay) || !isInk(i)) continue;
      let lines = linesAt(i);
      const box = boxOf(lines);
      for (const g of reach.values()) {
        if (!lines.length || !near(box, g.box, g.r)) continue;
        lines = cutNearPolylines(lines, g.lines, g.r).map(tidy);
        cutIdx.add(i);
      }
      current.set(i, lines);
      if (!lines.length) dropped.add(i);
    }
  }
  if (!cutIdx.size) return scene;
  const prims = scene.prims.flatMap((p, i) => {
    if (dropped.has(i)) return [];
    if (!cutIdx.has(i)) return [p];
    return [{ ...(p as PathPrim), d: toD(current.get(i)!) }];
  });
  return { ...scene, prims };
}
