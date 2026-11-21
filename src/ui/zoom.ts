import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 1 is "fit": the whole poster in the space there is. Larger zooms the poster itself, which is then scrolled and dragged. */
export const ZOOM_MIN = 1;
export const ZOOM_STEP = 1.25;
/** A CSS pixel is 1/96 in: the size the poster would be at 100% */
const CSS_DPI = 96;
/** most the poster is shown larger than its real size, as a share of it */
const MAX_ACTUAL = 4;
/** room kept above and beside the poster in the fit (the bar and a margin), px */
export const CHROME_PX = 120;

/** The size of the poster when it is as large as it can be in the stage and still whole. */
export function fitSize(viewW: number, viewH: number, aspect: number, maxH = Infinity): { w: number; h: number } {
  const h = Math.max(1, Math.min(viewH, maxH, viewW / aspect));
  return { w: h * aspect, h };
}

/** The zoom at which the poster is its real printed size on a screen (96 css px to the inch). */
export const actualZoom = (fitW: number, widthMm: number): number => (widthMm / 25.4 * CSS_DPI) / Math.max(1, fitW);

/** The largest zoom: four times its real size, and never less than four times fit. */
export const maxZoom = (fitW: number, widthMm: number): number => Math.max(4, MAX_ACTUAL * actualZoom(fitW, widthMm));

export const clampZoom = (z: number, max: number): number => (Number.isFinite(z) ? Math.min(max, Math.max(ZOOM_MIN, z)) : ZOOM_MIN);

/** What the zoom is called on screen: a share of the poster's real size. */
export const zoomPercent = (zoom: number, fitW: number, widthMm: number): number => Math.round((zoom / actualZoom(fitW, widthMm)) * 100);

/** How much a wheel turn (with Ctrl, or a trackpad pinch, which sends the same) zooms: smooth for small pinch steps, about 1.3x for a mouse notch. */
export const wheelFactor = (deltaY: number): number => Math.exp(-Math.max(-200, Math.min(200, deltaY)) * 0.0025);

/**
 * After the poster is resized, how far to scroll so that the point of it that was under the pointer is still there.
 * `frac` is where that point is on the poster (0 to 1), `edge` and `size` the poster's new left (or top) edge and length on screen,
 * `pointer` where the pointer is on screen along the same axis, `viewEdge` the viewport's own edge, `scroll` the current scroll.
 */
export const scrollToKeep = (frac: number, edge: number, size: number, pointer: number, viewEdge: number, scroll: number): number =>
  scroll + (edge + frac * size) - (viewEdge + pointer);

/**
 * Zoom for the poster preview. The viewport div scrolls; the sheet inside it is sized by `--zw`. Zoom with the buttons, with Ctrl and the
 * wheel (toward the pointer), with + - 0 on the keyboard; drag to pan when zoomed in.
 */
export function useZoom(widthMm: number, heightMm: number, enabled: boolean) {
  // the viewport only exists once there is a poster, so its element is kept in state: the effects below run when it appears
  const vpEl = useRef<HTMLDivElement | null>(null);
  const [vpNode, setVpNode] = useState<HTMLDivElement | null>(null);
  const vpRef = useCallback((el: HTMLDivElement | null) => { vpEl.current = el; setVpNode(el); }, []);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const [fitW, setFitW] = useState(600);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const panned = useRef(false);
  const [panning, setPanning] = useState(false);

  const z = enabled ? zoom : 1;
  const max = maxZoom(fitW, widthMm);

  // the size of the poster at fit follows the space there is, measured while it is not zoomed (a scrollbar would change it)
  useLayoutEffect(() => {
    const vp = vpNode;
    if (!vp || !enabled) return;
    const measure = () => {
      if (zoomRef.current !== 1) return;
      const { w } = fitSize(vp.clientWidth, vp.clientHeight, widthMm / heightMm, window.innerHeight - CHROME_PX);
      setFitW((old) => (Math.abs(old - w) > 0.5 ? w : old));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [vpNode, enabled, widthMm, heightMm, zoom]);

  /** zoom to `next`, keeping the point at (cx, cy) in the viewport (default: its middle) where it is */
  const setZoom = useCallback((next: number, at?: { cx: number; cy: number }) => {
    const vp = vpEl.current, sheet = sheetRef.current;
    const target = clampZoom(next, maxZoom(fitW, widthMm));
    if (vp && sheet) {
      const r = sheet.getBoundingClientRect(), v = vp.getBoundingClientRect();
      const cx = at?.cx ?? v.width / 2, cy = at?.cy ?? v.height / 2;
      anchor.current = { fx: (v.left + cx - r.left) / Math.max(1, r.width), fy: (v.top + cy - r.top) / Math.max(1, r.height), cx, cy };
    }
    zoomRef.current = target; // so a second turn of the wheel before the next draw builds on this one
    setZoomState(target);
  }, [fitW, widthMm]);

  // once the poster has its new size, scroll so the anchored point is under the pointer again
  useLayoutEffect(() => {
    const a = anchor.current, vp = vpEl.current, sheet = sheetRef.current;
    anchor.current = null;
    if (!a || !vp || !sheet) return;
    const r = sheet.getBoundingClientRect(), v = vp.getBoundingClientRect();
    vp.scrollLeft = scrollToKeep(a.fx, r.left, r.width, a.cx, v.left, vp.scrollLeft);
    vp.scrollTop = scrollToKeep(a.fy, r.top, r.height, a.cy, v.top, vp.scrollTop);
  }, [zoom]);

  // Ctrl + wheel (and a trackpad pinch) zooms toward the pointer; a plain wheel scrolls as usual
  useEffect(() => {
    const vp = vpNode;
    if (!vp || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const v = vp.getBoundingClientRect();
      setZoom(zoomRef.current * wheelFactor(e.deltaY), { cx: e.clientX - v.left, cy: e.clientY - v.top });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [vpNode, enabled, setZoom]);

  // + - 0 on the keyboard, unless a field has the focus
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoomRef.current * ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoomRef.current / ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, setZoom]);

  // back to fit when zooming is switched off (a narrow screen)
  useEffect(() => { if (!enabled) setZoomState(1); }, [enabled]);

  /** drag the poster around when it is zoomed in; `allow` says whether this press may (not on something else that drags) */
  const onPan = (e: React.PointerEvent, allow: (target: Element) => boolean = () => true) => {
    const vp = vpEl.current;
    if (!vp || zoomRef.current <= 1 || e.button !== 0 || !allow(e.target as Element)) return;
    const x0 = e.clientX, y0 = e.clientY, sl = vp.scrollLeft, st = vp.scrollTop;
    let moving = false;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moving) { moving = true; setPanning(true); }
      vp.scrollLeft = sl - (ev.clientX - x0);
      vp.scrollTop = st - (ev.clientY - y0);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (moving) {
        panned.current = true;
        setPanning(false);
        setTimeout(() => { panned.current = false; }, 0); // the click that follows the drag has come and gone by then, if it was going to
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  /** true once after a drag that panned, so the click that follows it is not taken as a click on the poster */
  const consumePan = () => { const p = panned.current; panned.current = false; return p; };

  return {
    vpRef, sheetRef, zoom: z, fitW, max, panning, onPan, consumePan, setZoom,
    percent: zoomPercent(z, fitW, widthMm),
    zoomIn: () => setZoom(zoomRef.current * ZOOM_STEP),
    zoomOut: () => setZoom(zoomRef.current / ZOOM_STEP),
    fit: () => setZoom(1),
    actual: () => setZoom(actualZoom(fitW, widthMm)),
    /** the sheet's width in px when zoomed */
    sheetPx: fitW * z,
  };
}
