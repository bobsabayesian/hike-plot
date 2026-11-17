import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { parseGpx, parseWaypoints } from '../gpx/parse';
import { sampleTrack, sampleWaypoints } from '../sample';
import { describePoolItem } from '../features/format';
import { ICONS, ICON_LABELS, KIND_LABELS, LANDMARK_KINDS, POINT_KINDS, requestCovers, requestIsEmpty, wantedRequest, type Icon, type Side } from '../features/types';
import { OpenByCode, SaveGroup, linkFor, useProjectSave } from './SaveGroup';
import { createShareLink } from '../share';
import { CustomRow } from './CustomRow';
import { PhotoPlaces } from './PhotoPlaces';
import { newCustomId } from '../features/custom';
import { composeScene, viewBBox, autoValues, featureView, routeView, viewSizeKm } from '../scene/buildScene';
import { computeStats } from '../geo/stats';
import { covers, loadTerrain, padBBox } from '../topo/terrain';
import { sceneToSvg } from '../export/svg';
import { pngSize, sceneToPng } from '../export/png';

/** width of the picture saved beside a project for the admin page, px */
const THUMB_PX = 480;
import { loadFonts } from '../export/fonts';
import { SPAN_MAX_KM, SPAN_MIN_KM, wheelSpan } from './wheel';
import { isDarkPaper } from '../scene/pens';
import { prepareScene, tipFor, type ExportMode, type PlotterText } from '../export/outlines';
import { summarizePasses } from '../export/offset';
import { PenSelect, PensPanel } from './PensPanel';
import { PagePanel } from './PagePanel';
import { Group, NARROW_QUERY, useGroups, useMediaQuery } from './Group';
import { FEATURE_PEN_LABELS, penFor } from '../scene/pens';
import type { FeaturePenKey } from '../features/types';
import type { Part } from '../scene/types';
import { CUSTOM_SIZE_ID, CUSTOM_SIZE_MAX_MM, CUSTOM_SIZE_MIN_MM, PRINT_SIZES, type SizeGroup, type Corner, type NorthStyle, type Align, type FontKey, type Placement, type StrokeStyle } from '../scene/project';

const PlaceRow = ({ value, onChange }: { value: Placement; onChange: (v: Placement) => void }) => (
  <Row label="Position">
    <select value={value} onChange={(e) => onChange(e.target.value as Placement)}>
      <option value="top">Top</option><option value="bottom">Bottom</option>
    </select>
  </Row>
);

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** "NW (315°)" for a direction in degrees clockwise from north. */
const compassName = (deg: number) => `${COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]} (${deg}°)`;

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="row"><label>{label}</label>{children}</div>
);

function download(name: string, data: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * What clicking each part of the poster opens: its group, a name for the action bar, and the control to focus there
 * (by default the group's header button).
 */
const PARTS: Record<Part, { group: string; label: string; focus?: string }> = {
  border: { group: 'border', label: 'Border' },
  title: { group: 'typography', label: 'Title', focus: '[data-edit="title"]' },
  location: { group: 'typography', label: 'Location', focus: '[data-edit="location"]' },
  info: { group: 'typography', label: 'Route info', focus: '[data-edit="info"]' },
  watermark: { group: 'export', label: 'Watermark', focus: '[data-edit="watermark"]' },
  contours: { group: 'contours', label: 'Contours' },
  relief: { group: 'relief', label: '3D relief' },
  water: { group: 'landmarks', label: 'Rivers and lakes', focus: '[data-edit="water"]' },
  profile: { group: 'profile', label: 'Elevation profile' },
  route: { group: 'route', label: 'Route' },
  north: { group: 'north', label: 'North arrow' },
  landmarks: { group: 'landmarks', label: 'Landmarks' },
};

/** The part of the poster under the pointer, if any: a landmark's own label first, then the part an element draws. */
function clickTarget(target: EventTarget | null): { group: string; label: string; focus: string } | undefined {
  const el = target instanceof Element ? target : null;
  const lm = el?.closest('[data-lm]');
  const id = lm?.getAttribute('data-lm');
  if (id) return { group: 'landmarks', label: `Landmark: ${lm!.textContent ?? ''}`, focus: `[data-lm-input="${CSS.escape(id)}"]` };
  const part = el?.closest('[data-part]')?.getAttribute('data-part') as Part | null | undefined;
  const info = part ? PARTS[part] : undefined;
  if (!info) return undefined;
  return { group: info.group, label: info.label, focus: info.focus ?? `#group-${info.group} .group-title button` };
}

/** Search for a place by name, and the list of matches to choose from (the first is chosen straight away). */
function PlaceSearch({ autoFocus }: { autoFocus?: boolean }) {
  const { searchFeature, busy, notice, searchResults, searchIndex, chooseResult, project } = useStore();
  const [query, setQuery] = useState('');
  return (<>
    <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) searchFeature(query.trim()); }}>
      <input type="text" aria-label="Place name" placeholder="e.g. Mount Rainier" autoFocus={autoFocus} value={query} onChange={(e) => setQuery(e.target.value)} />
      <button disabled={!!busy}>{busy || 'Search'}</button>
    </form>
    {notice && <div className="err">{notice}</div>}
    {searchResults.length > 1 && (
      <div className="results">
        {searchResults.map((r, i) => (
          <button key={`${r.lat},${r.lon},${i}`} className={i === searchIndex && project.feature ? 'res sel' : 'res'} onClick={() => chooseResult(i)}>
            <b>{r.name}</b>
            <span>{[r.kind, r.location].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
    )}
  </>);
}

/**
 * A zone that takes a dropped .gpx file. Given plain children, the whole zone is a button that opens the file picker;
 * given a function, it is a plain box and the function gets `pick` to open the picker from a button of its own.
 */
function GpxDrop({ onFile, className = '', children }: { onFile: (f?: File) => void; className?: string; children: ReactNode | ((pick: () => void) => ReactNode) }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();
  const whole = typeof children !== 'function';
  return (
    <div className={`drop ${className}${over ? ' over' : ''}`}
      {...(whole ? { role: 'button', tabIndex: 0, onClick: pick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } } : {})}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}>
      {whole ? children : children(pick)}
      <input ref={input} type="file" accept=".gpx" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

/**
 * How much map the poster shows: a view-width slider, and the mouse wheel over the whole block zooms (wheel up =
 * slider left = closer). With `fitAtMin` the slider's left end is "fit snugly" (undefined), as for a route, which can
 * be widened but never cut; otherwise the button returns to the automatic view.
 */
function ViewZoom({ valueKm, minKm, maxKm, isAuto, fitAtMin, onSpan, note, children }: {
  valueKm: number; minKm: number; maxKm: number; isAuto: boolean; fitAtMin?: boolean; onSpan: (km: number | undefined) => void; note: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = Math.min(maxKm, Math.max(minKm, Math.round(valueKm)));
  const pick = (km: number) => (fitAtMin && km <= minKm ? undefined : km);
  const latest = useRef({ shown, minKm, maxKm, pick, onSpan });
  latest.current = { shown, minKm, maxKm, pick, onSpan };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A non-passive listener is needed so the page doesn't scroll while the wheel is used here.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines -> pixels
      const l = latest.current;
      l.onSpan(l.pick(wheelSpan(l.shown, delta, l.minKm, l.maxKm)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="found" ref={ref} title="Scroll the mouse wheel here to zoom: up zooms in, down zooms out">
      {children}
      <div className="hint">{note} · scroll to zoom</div>
      <Row label="View width">
        <input type="range" min={minKm} max={maxKm} step={1} value={shown} onChange={(e) => onSpan(pick(+e.target.value))} />
        <span>{shown} km</span>
        <button type="button" disabled={isAuto} onClick={() => onSpan(undefined)}>{fitAtMin ? 'Fit' : 'Auto'}</button>
      </Row>
    </div>
  );
}

/** The "Showing <feature>" block for a searched place, with its zoom. */
function FeatureStatus({ feature, onSpan }: { feature: NonNullable<ReturnType<typeof useStore.getState>['project']['feature']>; onSpan: (km: number | undefined) => void }) {
  const [w, h] = viewSizeKm(featureView(feature));
  return (
    <ViewZoom valueKm={w} minKm={SPAN_MIN_KM} maxKm={SPAN_MAX_KM} isAuto={feature.spanKm === undefined} onSpan={onSpan}
      note={`${feature.lat.toFixed(4)}°, ${feature.lon.toFixed(4)}° · view about ${Math.round(w)} × ${Math.round(h)} km`}>
      <div>Showing <b>{feature.name}</b>{feature.kind ? ` (${feature.kind})` : ''}</div>
    </ViewZoom>
  );
}

/**
 * A GPX route's zoom: from fitting the route snugly (the slider's left end) out to several times its size, to show
 * more of the land around it. The route is never cut off.
 */
function RouteZoom({ points, spanKm, onSpan, children }: { points: { lat: number; lon: number }[]; spanKm?: number; onSpan: (km: number | undefined) => void; children: ReactNode }) {
  const [rw, rh] = viewSizeKm(routeView(points));
  const fitKm = Math.max(SPAN_MIN_KM, Math.ceil(Math.max(rw, rh)));
  const [w, h] = viewSizeKm(routeView(points, spanKm));
  return (
    <ViewZoom valueKm={spanKm ?? fitKm} minKm={fitKm} maxKm={Math.max(SPAN_MAX_KM, fitKm * 4)} isAuto={spanKm === undefined} fitAtMin onSpan={onSpan}
      note={`view about ${Math.round(w)} × ${Math.round(h)} km${spanKm === undefined ? ', fitted to the route' : ''}`}>
      {children}
    </ViewZoom>
  );
}

export function App() {
  const { project: p, set, terrain, terrainStatus, terrainError, setTerrain, loadPoints, osm, osmStatus, osmError, loadOsm, retryOsm, openProject } = useStore();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [tab, setTab] = useState<'settings' | 'poster'>('settings');
  const gp = useGroups(narrow);
  // Until there is a route or a place there is no map, and the start screen is shown instead of the editor.
  const hasMap = p.points.length >= 2 || !!p.feature;
  // on a phone, show the poster as soon as there is something to look at
  const hadMap = useRef(hasMap);
  useEffect(() => {
    if (hasMap && !hadMap.current && narrow) setTab('poster');
    hadMap.current = hasMap;
  }, [hasMap, narrow]);
  /** the GPX file's name, when the route came from a file in this session */
  const [srcName, setSrcName] = useState('');
  const [searching, setSearching] = useState(false);
  // Click any part of the poster to edit it: open its group and focus the most useful control there (a landmark
  // label focuses its own name box). Hovering names what a click would open, in the action bar.
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);
  const [hovered, setHovered] = useState('');
  const editAt = (e: React.MouseEvent) => {
    const hit = clickTarget(e.target);
    if (!hit) return;
    setTab('settings');
    gp.show(hit.group);
    setPendingEdit(hit.focus);
  };
  useEffect(() => {
    if (!pendingEdit) return;
    // wait a moment for the group to open (and on a phone, for the Settings tab to show)
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(pendingEdit);
      el?.scrollIntoView({ block: 'center' });
      el?.focus();
      if (el instanceof HTMLInputElement && el.type === 'text') el.select();
      setPendingEdit(null);
    }, 50);
    return () => clearTimeout(t);
  }, [pendingEdit]);
  /** the SVG as the Export settings say (plotter: a layer per pen), for download or for a link */
  const makeSvg = async () => {
    const out = prepareScene(scene, mode, mode === 'live' ? undefined : await loadFonts(), { pens: p.pens, plotterText: plotText });
    return sceneToSvg(out, { paper: paperInExport && mode !== 'plotter', ...(mode === 'plotter' ? { layers: 'pen' as const, pens: p.pens } : {}) });
  };
  const showPoster = () => { if (narrow) setTab('poster'); };
  /** a GPX that could not be read: shown where the file was dropped */
  const [err, setErr] = useState('');
  /** an export that failed: shown in the action bar, next to the button */
  const [exportErr, setExportErr] = useState('');
  const [svgBusy, setSvgBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');
  const [paperInExport, setPaperInExport] = useState(false);
  const [mode, setMode] = useState<ExportMode>('plotter');
  const [dpi, setDpi] = useState(150);
  const [pngBusy, setPngBusy] = useState(false);
  const downloadSvg = async () => {
    setSvgBusy(true); setExportErr('');
    try { download('hike-poster.svg', await makeSvg(), 'image/svg+xml'); }
    catch (e) { setExportErr(e instanceof Error ? e.message : 'SVG export failed'); }
    finally { setSvgBusy(false); }
  };
  const downloadPng = async () => {
    setPngBusy(true); setExportErr('');
    try { download('hike-poster.png', (await sceneToPng(scene, dpi)).blob, 'image/png'); }
    catch (e) { setExportErr(e instanceof Error ? e.message : 'PNG export failed'); }
    finally { setPngBusy(false); }
  };

  // While a 3D slider is held, draw a lighter version (no hidden-line cut, fewer rows) so dragging stays smooth.
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    if (!draft) return;
    const end = () => setDraft(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, [draft]);
  const shown = useMemo(() => (draft && p.relief.enabled ? { ...p, relief: { ...p.relief, hideHidden: false, rows: Math.min(p.relief.rows, 40) } } : p), [p, draft]);
  const composed = useMemo(() => composeScene(shown, terrain, osm), [shown, terrain, osm]);
  const scene = composed.scene;
  // Route and elevation-profile controls only mean something once a GPX track is loaded.
  const hasTrack = p.points.length > 0;
  const need = useMemo(() => viewBBox(p), [p]);
  const auto = useMemo(() => autoValues(p, p.points.length ? computeStats(p.points) : undefined), [p]);
  // what the admin page shows beside a saved project: the title and place as printed, the headline numbers, the paper size and a small picture
  const saveMeta = {
    title: auto.title, place: auto.location, distance: auto.info.distance, gain: auto.info.gain,
    size: `${PRINT_SIZES.find((s) => s.id === p.sizeId)?.label ?? 'custom'}${p.landscape ? ' landscape' : ''}`,
  };
  const saveThumb = async () => {
    const { widthMm } = scene;
    return (await sceneToPng(scene, (THUMB_PX / widthMm) * 25.4)).blob;
  };
  const saver = useProjectSave({ project: p, openProject, meta: saveMeta, thumb: saveThumb });

  // Fetch landmarks/water whenever the visible area, or what we want to show, is not covered by what we have.
  const want = useMemo(() => wantedRequest(p.features), [p.features.kinds, p.features.water, p.features.waterLabels]);
  useEffect(() => {
    if (!p.features.enabled || !need || requestIsEmpty(want)) return;
    const c = osm?.covers;
    const inside = c && need.minLat >= c.minLat && need.maxLat <= c.maxLat && need.minLon >= c.minLon && need.maxLon <= c.maxLon;
    if (inside && requestCovers(osm?.requested, want)) return;
    const t = setTimeout(() => loadOsm(padBBox(need, 0.05), want), 600);
    return () => clearTimeout(t);
  }, [need, p.features.enabled, osm, want, loadOsm]);

  // Fetch terrain whenever the visible map area is not covered by what we already have.
  useEffect(() => {
    if (!(p.terrain.enabled || p.relief.enabled) || !need) return;
    if (terrain && covers(terrain, need)) return;
    let live = true;
    const t = setTimeout(() => {
      useStore.setState({ terrainStatus: 'loading' });
      loadTerrain(padBBox(need, 0.1))
        .then((field) => live && setTerrain(field, 'idle'))
        .catch((e) => live && setTerrain(undefined, 'error', e instanceof Error ? e.message : 'Terrain failed'));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [need, p.terrain.enabled, p.relief.enabled, terrain, setTerrain]);
  // Which line weights in this design become several passes with the chosen pen (plotter export).
  const passes = useMemo(() => summarizePasses(scene.prims, (x) => tipFor(x as { pen?: string }, { pens: p.pens })), [scene, p.pens]);
  const [plotText, setPlotText] = useState<PlotterText>('auto');
  const [plotPreview, setPlotPreview] = useState(false);
  const [plotSvg, setPlotSvg] = useState('');
  // The plotter preview: the poster as the pens will draw it (hatched, passes, ink width, translucency). Slower, so it follows edits after a pause.
  useEffect(() => {
    if (!plotPreview) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const out = prepareScene(scene, 'plotter', await loadFonts(), { pens: p.pens, plotterText: plotText });
        const svg = sceneToSvg(out, { paper: true, ink: { pens: p.pens, dark: isDarkPaper(p.paper) } });
        if (live) setPlotSvg(svg);
      } catch { if (live) setPlotSvg(''); }
    }, draft ? 0 : 250);
    return () => { live = false; clearTimeout(t); };
  }, [plotPreview, scene, p.pens, p.paper, draft, plotText]);
  const designSvg = useMemo(() => sceneToSvg(scene, { paper: true, ids: true }), [scene]);
  const previewSvg = plotPreview && plotSvg ? plotSvg : designSvg;

  async function load(file?: File) {
    if (!file) return;
    try {
      const xml = await file.text();
      const pts = parseGpx(xml);
      if (pts.length < 2) throw new Error('This file has no track to draw (it needs at least two points).');
      loadPoints(pts, true, parseWaypoints(xml));
      setSrcName(file.name);
      setSearching(false);
      setErr('');
      showPoster();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read file');
    }
  }

  const useSample = () => { const t = sampleTrack(); loadPoints(t, false, sampleWaypoints(t)); setSrcName('Sample route'); setSearching(false); setErr(''); showPoster(); };
  const footer = (
    <footer className="notice">
      Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL), served as vector tiles by <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> (© <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>). Place search by Nominatim. Elevation: Terrain Tiles on AWS (SRTM, GMTED and other sources).
    </footer>
  );

  if (!hasMap) return (
    <div className="app empty">
      <main className="start">
        <h1>Walk of Frame</h1>
        <p className="lede">Turn a hike or a mountain into a poster or a pen-plotter drawing.</p>
        {saver.busy === 'Opening…' ? <div className="hint">Opening the saved project…</div> : (<>
          <div className="choices">
            <section className="choice">
              <h2>Draw a hike</h2>
              <GpxDrop className="big" onFile={load}>Drop a .gpx file here<br /><span className="hint">or click to choose one</span></GpxDrop>
              {err && <div className="err">{err}</div>}
            </section>
            <section className="choice">
              <h2>Draw a place</h2>
              <PlaceSearch />
              <div className="hint">A mountain, lake, park or town.</div>
            </section>
          </div>
          <div className="start-more">
            <button type="button" onClick={useSample}>Try the sample route</button>
            <div className="open">
              <span className="hint">Open a saved project</span>
              <OpenByCode s={saver} />
            </div>
          </div>
          {saver.msg?.error && <div className="err">{saver.msg.text}</div>}
        </>)}
      </main>
      {footer}
    </div>
  );

  return (
    <div className={`app${narrow ? ' narrow' : ''}`}>
      {narrow ? (
        <div className="tabs" role="tablist" aria-label="View"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const next = tab === 'settings' ? 'poster' : 'settings';
            setTab(next);
            document.getElementById(`tab-${next}`)?.focus();
            e.preventDefault();
          }}>
          {(['settings', 'poster'] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={t === 'settings' ? 'panel-settings' : 'preview'} tabIndex={tab === t ? 0 : -1}
              className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t === 'settings' ? 'Settings' : 'Poster'}
            </button>
          ))}
        </div>
      ) : (
        <a className="skip-link" href="#preview">Skip to the poster</a>
      )}
      <div className="side" id="panel-settings" hidden={narrow && tab !== 'settings'} {...(narrow ? { role: 'tabpanel', 'aria-labelledby': 'tab-settings' } : {})}>
        <h1>Walk of Frame</h1>
        {/* What the poster is drawn from, and how to swap it. A .gpx can be dropped anywhere on this card. */}
        <GpxDrop className="source" onFile={load}>{(pick) => (
          <div className="source-body">
            {hasTrack ? (<>
              <div className="hint source-label">Route</div>
              <RouteZoom points={p.points} spanKm={p.routeSpanKm} onSpan={(km) => set((x) => { x.routeSpanKm = km; })}>
                <div><b>{srcName || auto.title}</b></div>
                <div className="hint">{[auto.info.distance, auto.info.gain && `${auto.info.gain} gain`, `${p.points.length.toLocaleString()} points`].filter(Boolean).join(' · ')}</div>
              </RouteZoom>
            </>) : p.feature && (<>
              <div className="hint source-label">Place</div>
              <FeatureStatus feature={p.feature} onSpan={(km) => set((x) => { x.feature!.spanKm = km; })} />
            </>)}
            <div className="row">
              <button type="button" onClick={pick}>{hasTrack ? 'Replace GPX' : 'Load a GPX'}</button>
              <button type="button" aria-expanded={searching || !hasTrack} onClick={() => setSearching((v) => !v)} hidden={!hasTrack}>Find a place</button>
              <button type="button" onClick={useSample}>Sample</button>
            </div>
            {(searching || !hasTrack) && <PlaceSearch autoFocus={searching} />}
            {err && <div className="err">{err}</div>}
            <div className="hint">Drop a .gpx on this box to replace the route. A new route or place clears your landmark edits.</div>
          </div>
        )}</GpxDrop>

        <div className="side-stage">Map</div>
        {hasTrack && (<Group id="route" title="Route" {...gp('route')}>
        <Row label="Pen"><PenSelect pens={p.pens} value={p.route.pen} onChange={(id) => set((x) => { x.route.pen = id!; })} /></Row>
        <Row label="Weight">
          <input type="range" min={0.2} max={3} step={0.1} value={p.route.weightMm} onChange={(e) => set((x) => { x.route.weightMm = +e.target.value; })} />
          <span>{p.route.weightMm.toFixed(1)} mm</span>
        </Row>
        <Row label="Style">
          <select value={p.route.style} onChange={(e) => set((x) => { x.route.style = e.target.value as StrokeStyle; })}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
        </Row>
        <Row label="Clear beside route"><input type="range" min={0} max={3} step={0.1} value={p.route.clearMm ?? 0} onChange={(e) => set((x) => { x.route.clearMm = +e.target.value; })} /><span>{p.route.clearMm ? `${p.route.clearMm.toFixed(1)} mm` : 'off'}</span></Row>
        <div className="hint">Cuts the contour and 3D relief lines this far from the route's edge (the edge follows the route's weight or its pen's line, whichever is wider), so the route has clear paper beside it.</div>
        </Group>)}

        <Group id="contours" title="Contours" {...gp('contours')}
          toggle={{ on: p.terrain.enabled, onChange: (v) => set((x) => { x.terrain.enabled = v; }), status: p.terrain.enabled && terrainStatus === 'loading' ? 'Loading…' : undefined }}>
        {terrainError && <div className="err">{terrainError}</div>}
        {p.terrain.enabled && (<>
          <Row label="Interval">
            <select value={p.terrain.intervalM} onChange={(e) => set((x) => { x.terrain.intervalM = +e.target.value; })}>
              <option value={0}>Auto</option>
              {[10, 20, 25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} m</option>)}
            </select>
          </Row>
          <Row label="Heavy every">
            <select value={p.terrain.indexEvery} onChange={(e) => set((x) => { x.terrain.indexEvery = +e.target.value; })}>
              <option value={0}>None</option>
              {[4, 5, 10].map((n) => <option key={n} value={n}>{n}th line</option>)}
            </select>
          </Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.terrain.pen} onChange={(id) => set((x) => { x.terrain.pen = id!; })} /></Row>
          {p.terrain.indexEvery > 0 && (
            <Row label="Heavy pen"><PenSelect pens={p.pens} value={p.terrain.indexPen} allowDefault={`Same pen, drawn twice (${penFor(p.pens, p.terrain.pen).name})`} onChange={(id) => set((x) => { if (id === undefined || id === x.terrain.pen) delete x.terrain.indexPen; else x.terrain.indexPen = id; })} /></Row>
          )}
          <Row label="Weight"><input type="range" min={0.05} max={0.6} step={0.01} value={p.terrain.weightMm} onChange={(e) => set((x) => { x.terrain.weightMm = +e.target.value; x.terrain.indexWeightMm = +e.target.value * 2; })} /></Row>
          <Row label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={p.terrain.opacity} onChange={(e) => set((x) => { x.terrain.opacity = +e.target.value; })} /></Row>
          {p.terrain.indexEvery > 0 && (<>
            <Row label="Number heavy lines"><input type="checkbox" checked={p.terrain.labels.enabled} onChange={(e) => set((x) => { x.terrain.labels.enabled = e.target.checked; })} /><span>elevation along the line</span></Row>
            {p.terrain.labels.enabled && (<>
              <Row label="How many">
                <select value={p.terrain.labels.density} onChange={(e) => set((x) => { x.terrain.labels.density = e.target.value as typeof p.terrain.labels.density; })}>
                  <option value="sparse">Few per line</option><option value="normal">Some per line</option><option value="dense">Many per line</option>
                </select>
              </Row>
              <Row label="Which lines">
                <select value={p.terrain.labels.every} onChange={(e) => set((x) => { x.terrain.labels.every = +e.target.value; })}>
                  <option value={1}>Every heavy line</option><option value={2}>Every 2nd heavy line</option><option value={3}>Every 3rd heavy line</option>
                </select>
              </Row>
              <Row label="Break the line"><input type="checkbox" checked={p.terrain.labels.gap} onChange={(e) => set((x) => { x.terrain.labels.gap = e.target.checked; })} /><span>gap behind each number</span></Row>
              <Row label="Number size"><input type="number" min={5} max={30} value={p.terrain.labels.sizePt} onChange={(e) => set((x) => { x.terrain.labels.sizePt = +e.target.value || 8; })} /></Row>
            </>)}
          </>)}
        </>)}

        </Group>

        <Group id="relief" title="3D relief" {...gp('relief')}
          toggle={{ on: p.relief.enabled, onChange: (v) => set((x) => { x.relief.enabled = v; }), status: p.relief.enabled && terrainStatus === 'loading' ? 'Loading…' : undefined }}>
          {p.relief.enabled && (<div onPointerDownCapture={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range') setDraft(true); }}>
            <div className="row">
              {([['Top-down', { turn: 0, tilt: 0, perspective: 0 }], ['Oblique', { turn: 0, tilt: 55, perspective: 35 }], ['Angled', { turn: 35, tilt: 62, perspective: 40 }]] as const).map(([name, v]) => (
                <button key={name} type="button" onClick={() => set((x) => { Object.assign(x.relief, v); })}>{name}</button>
              ))}
            </div>
            <Row label="Lines">
              <select value={p.relief.style} onChange={(e) => set((x) => { x.relief.style = e.target.value as typeof p.relief.style; })}>
                <option value="contours">Contours on the surface</option>
                <option value="rows">Ridge rows (slices)</option>
                <option value="both">Both</option>
              </select>
            </Row>
            {p.relief.style !== 'contours' && (
              <Row label="Rows"><input type="range" min={20} max={200} step={1} value={p.relief.rows} onChange={(e) => set((x) => { x.relief.rows = +e.target.value; })} /><span>{p.relief.rows}</span></Row>
            )}
            <Row label="Turn"><input type="range" min={-180} max={180} step={1} value={p.relief.turn} onChange={(e) => set((x) => { x.relief.turn = +e.target.value; })} /><span>{p.relief.turn}°</span></Row>
            <Row label="Tilt"><input type="range" min={0} max={85} step={1} value={p.relief.tilt} onChange={(e) => set((x) => { x.relief.tilt = +e.target.value; })} /><span>{p.relief.tilt}°</span></Row>
            <Row label="Perspective"><input type="range" min={0} max={100} step={1} value={p.relief.perspective} onChange={(e) => set((x) => { x.relief.perspective = +e.target.value; })} /><span>{p.relief.perspective}</span></Row>
            <Row label="Height"><input type="range" min={50} max={400} step={5} value={p.relief.depth} onChange={(e) => set((x) => { x.relief.depth = +e.target.value; })} /><span>{p.relief.depth}%</span></Row>
            {p.relief.style !== 'contours' && (
              <Row label="Row weight"><input type="number" min={0.05} max={2} step={0.05} value={p.relief.rowWeightMm} onChange={(e) => set((x) => { x.relief.rowWeightMm = Math.max(0.05, +e.target.value || 0.18); })} /><span className="unit">mm</span></Row>
            )}
            <Row label="Hide behind hills"><input type="checkbox" checked={p.relief.hideHidden} onChange={(e) => set((x) => { x.relief.hideHidden = e.target.checked; })} /><span>cut lines a hill would hide</span></Row>
            <div className="hint">Tilt 0 is the flat map. Height is how much the hills are exaggerated (100% is true proportions). Lines use the Contours pen. The route always stays visible; landmarks behind a hill are left out. While you drag a slider the preview is simplified and fills in when you let go.</div>
          </div>)}
        </Group>

        <Group id="shade" title="Shading" {...gp('shade')}
          toggle={{ on: p.shade.enabled, onChange: (v) => set((x) => { x.shade.enabled = v; }) }}>
          {p.shade.enabled && (<div onPointerDownCapture={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range') setDraft(true); }}>
            <Row label="Sun from"><input type="range" min={0} max={359} step={1} value={p.shade.sunAzimuth} onChange={(e) => set((x) => { x.shade.sunAzimuth = +e.target.value; })} /><span>{compassName(p.shade.sunAzimuth)}</span></Row>
            <Row label="Sun height"><input type="range" min={10} max={70} step={1} value={p.shade.sunAltitude} onChange={(e) => set((x) => { x.shade.sunAltitude = +e.target.value; })} /><span>{p.shade.sunAltitude}°</span></Row>
            <Row label="In shade"><input type="range" min={5} max={70} step={1} value={p.shade.amount} onChange={(e) => set((x) => { x.shade.amount = +e.target.value; })} /><span>{p.shade.amount}%</span></Row>
            <Row label="Extra lines">
              <select value={p.shade.extra} onChange={(e) => set((x) => { x.shade.extra = +e.target.value as typeof p.shade.extra; })}>
                <option value={0}>None</option><option value={1}>1 between each pair</option><option value={3}>3, deepening in the darkest shade</option>
              </select>
            </Row>
            <Row label="Darker lines"><input type="checkbox" checked={p.shade.darken} onChange={(e) => set((x) => { x.shade.darken = e.target.checked; })} /><span>shaded parts of each line</span></Row>
            <Row label="Pen"><PenSelect pens={p.pens} value={p.shade.pen} allowDefault={`Contour pen, drawn twice (${penFor(p.pens, p.terrain.pen).name})`} onChange={(id) => set((x) => { if (id === undefined || id === x.terrain.pen) delete x.shade.pen; else x.shade.pen = id; })} /></Row>
            <div className="hint">Slopes facing away from the sun are drawn darker, like hillshading made of lines. "In shade" is the share of the land that counts as shaded. Works on the contours and on 3D relief rows; heavy contour lines are left as they are.</div>
          </div>)}
        </Group>

        <Group id="landmarks" title="Landmarks" {...gp('landmarks')}
          toggle={{ on: p.features.enabled, onChange: (v) => set((x) => { x.features.enabled = v; }), status: p.features.enabled && osmStatus === 'loading' ? 'Loading…' : undefined }}>
        {osmError && <div className="err">{osmError} <button onClick={retryOsm}>Retry</button></div>}
        {osm?.note && <div className="hint">{osm.note}</div>}
        {osm?.partial?.length ? (
          <div className="hint">
            {osm.partial.includes('water') ? 'Rivers and lakes are unavailable for this area right now' : 'Some landmarks are unavailable right now'}
            {' '}(OpenStreetMap servers are busy or the area is large). <button onClick={retryOsm}>Retry</button>
            {osm.reason && <div title={osm.reason}>Details: {osm.reason}</div>}
          </div>
        ) : null}
        {p.features.enabled && (<>
          <Row label="Max points"><input type="range" min={0} max={20} step={1} value={p.features.maxLabels} onChange={(e) => set((x) => { x.features.maxLabels = +e.target.value; })} /><span>{p.features.maxLabels}</span></Row>
          <Row label="Max water names"><input type="range" min={0} max={10} step={1} value={p.features.maxWaterLabels} onChange={(e) => set((x) => { x.features.maxWaterLabels = +e.target.value; })} /><span>{p.features.maxWaterLabels}</span></Row>
          <div className="kinds">
            {LANDMARK_KINDS.map((k) => (
              <label key={k}><input type="checkbox" checked={p.features.kinds[k]} onChange={(e) => set((x) => { x.features.kinds[k] = e.target.checked; })} /> {KIND_LABELS[k]}</label>
            ))}
            <label title="Draw rivers and lake shapes"><input type="checkbox" data-edit="water" checked={p.features.water} onChange={(e) => set((x) => { x.features.water = e.target.checked; })} /> Water outlines</label>
            <label title="Write river and lake names"><input type="checkbox" checked={p.features.waterLabels} onChange={(e) => set((x) => { x.features.waterLabels = e.target.checked; })} /> Water labels</label>
          </div>
          <Row label="Clear around labels"><input type="range" min={0} max={20} step={0.5} value={p.features.clearMm ?? 0} onChange={(e) => set((x) => { x.features.clearMm = +e.target.value; })} /><span>{p.features.clearMm ? `${p.features.clearMm} mm` : 'off'}</span></Row>
          <Row label="Size (pt)"><input type="number" min={6} max={60} value={p.features.sizePt} onChange={(e) => set((x) => { x.features.sizePt = +e.target.value || 11; })} /></Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.features.pens.default} onChange={(id) => set((x) => { x.features.pens.default = id!; })} /></Row>
          <details className="overrides">
            <summary>Pen for each kind</summary>
            {(Object.keys(FEATURE_PEN_LABELS) as FeaturePenKey[]).map((k) => (
              <Row key={k} label={FEATURE_PEN_LABELS[k]}>
                <PenSelect
                  pens={p.pens}
                  value={p.features.pens.overrides[k]}
                  allowDefault={`Same as landmarks (${penFor(p.pens, p.features.pens.default).name})`}
                  onChange={(id) => set((x) => { if (id === undefined) delete x.features.pens.overrides[k]; else x.features.pens.overrides[k] = id; })}
                />
              </Row>
            ))}
          </details>
          <details className="overrides">
            <summary>Icon for each kind</summary>
            {[...POINT_KINDS, 'waypoint' as const].map((k) => (
              <Row key={k} label={KIND_LABELS[k]}>
                <select value={p.features.icons?.[k] ?? 'default'} onChange={(e) => set((x) => { x.features.icons = { ...x.features.icons, [k]: e.target.value as Icon }; })}>
                  {ICONS.map((i) => <option key={i} value={i}>{ICON_LABELS[i]}</option>)}
                </select>
              </Row>
            ))}
          </details>
          <div className="custom">
            <div className="hint">Your own landmarks</div>
            {(p.customLandmarks ?? []).map((c) => (
              <CustomRow key={c.id} c={c} hasTrack={p.points.length > 0}
                onChange={(patch) => set((x) => { x.customLandmarks = x.customLandmarks.map((q) => (q.id === c.id ? { ...q, ...patch } : q)); if ('name' in patch && x.features.overrides[c.id]) delete x.features.overrides[c.id]!.name; })}
                onRemove={() => set((x) => { x.customLandmarks = x.customLandmarks.filter((q) => q.id !== c.id); delete x.features.overrides[c.id]; })} />
            ))}
            <div className="row">
              <button type="button" disabled={!p.points.length} title={p.points.length ? '' : 'Load a GPX first'} onClick={() => set((x) => { x.customLandmarks = [...(x.customLandmarks ?? []), { id: newCustomId(x.customLandmarks ?? []), name: 'Start', at: 'start' }]; })}>+ Start</button>
              <button type="button" disabled={!p.points.length} title={p.points.length ? '' : 'Load a GPX first'} onClick={() => set((x) => { x.customLandmarks = [...(x.customLandmarks ?? []), { id: newCustomId(x.customLandmarks ?? []), name: 'Finish', at: 'end' }]; })}>+ End</button>
              <button type="button" onClick={() => set((x) => {
                const mid = need ? { lat: +((need.minLat + need.maxLat) / 2).toFixed(5), lon: +((need.minLon + need.maxLon) / 2).toFixed(5) } : { lat: 0, lon: 0 };
                x.customLandmarks = [...(x.customLandmarks ?? []), { id: newCustomId(x.customLandmarks ?? []), name: 'My place', at: 'latlon', ...mid }];
              })}>+ Lat/lon</button>
            </div>
          </div>
          {composed.landmarks?.map((l) => {
            const ov = p.features.overrides[l.id] ?? {};
            const edit = (patch: Partial<typeof ov>) => set((x) => { x.features.overrides[l.id] = { ...x.features.overrides[l.id], ...patch }; });
            return (
              <div className="lm" key={l.id}>
                <input type="checkbox" title="Show" checked={!l.hidden} onChange={(e) => edit({ hidden: !e.target.checked })} />
                <input type="text" data-lm-input={l.id} title={KIND_LABELS[l.kind]} value={ov.name ?? l.name} onChange={(e) => edit({ name: e.target.value })} />
                <select title="Label side" value={ov.side ?? 'auto'} disabled={l.kind === 'lake' || l.kind === 'river'} onChange={(e) => edit({ side: e.target.value as Side })}>
                  <option value="auto">Auto</option><option value="right">Right</option><option value="left">Left</option>
                  <option value="above">Above</option><option value="below">Below</option>
                </select>
                <select title="Icon" value={ov.icon ?? 'default'} onChange={(e) => edit({ icon: e.target.value as Icon })}>
                  {ICONS.map((i) => <option key={i} value={i}>{i === 'default' ? 'Icon' : ICON_LABELS[i]}</option>)}
                </select>
                <input type="number" min={0} max={40} step={0.5} title="Clear the terrain lines this many mm around this label (blank: use the general setting)" placeholder="clear" value={ov.clearMm ?? ''}
                  onChange={(e) => edit({ clearMm: e.target.value === '' ? undefined : Math.max(0, +e.target.value) })} />
                {!l.placed && !l.hidden && <span className="hint" title="No room for this label">no room</span>}
              </div>
            );
          })}
          {(['point', 'water'] as const).map((group) => {
            const open = composed.open?.[group] ?? 0;
            const items = (composed.pool ?? []).filter((it) => it.group === group);
            if (open <= 0 || (group === 'water' && !p.features.waterLabels)) return null;
            const noun = group === 'water' ? 'water name' : 'landmark';
            return (
              <div className="slot" key={group}>
                <div className="hint">
                  {open} open {noun} slot{open > 1 ? 's' : ''}. {items.length ? 'Choose what to add:' : `No other ${noun}s nearby.`}
                </div>
                {items.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) set((x) => { x.features.overrides[id] = { ...x.features.overrides[id], pinned: true, hidden: false }; });
                    }}
                  >
                    <option value="">Add {noun}…</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{describePoolItem(it, p.units)}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          <PhotoPlaces onPlaces={(places) => set((x) => {
            let list = x.customLandmarks ?? [];
            for (const pl of places) list = [...list, { id: newCustomId(list), name: pl.name, at: 'latlon' as const, lat: pl.lat, lon: pl.lon }];
            x.customLandmarks = list;
          })} />
        </>)}

        </Group>

        {hasTrack && (<Group id="profile" title="Elevation profile" {...gp('profile')}
          toggle={{ on: p.profile.enabled, onChange: (v) => set((x) => { x.profile.enabled = v; }) }}>
        {p.profile.enabled && (<>
          <Row label="Position">
            <select value={p.profile.position} onChange={(e) => set((x) => { x.profile.position = e.target.value as typeof p.profile.position; })}>
              <option value="bottom">Bottom</option><option value="corner">Bottom corner</option>
            </select>
          </Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.profile.pen} onChange={(id) => set((x) => { x.profile.pen = id!; })} /></Row>
          <Row label="Fill (plotter)">
            <select value={p.profile.hatch} onChange={(e) => set((x) => { x.profile.hatch = e.target.value as typeof p.profile.hatch; })}>
              <option value="off">Outline only</option><option value="light">Light hatching</option><option value="medium">Medium hatching</option><option value="solid">Solid hatching</option>
            </select>
          </Row>
          <Row label="Opacity"><input type="range" min={0} max={1} step={0.02} value={p.profile.opacity} onChange={(e) => set((x) => { x.profile.opacity = +e.target.value; })} /></Row>
                  <Row label="Label peaks"><input type="checkbox" checked={p.profile.labels.extremes} onChange={(e) => set((x) => { x.profile.labels.extremes = e.target.checked; })} /><span>highest and lowest point</span></Row>
          <Row label="Elevation ticks"><input type="checkbox" checked={p.profile.labels.yTicks} onChange={(e) => set((x) => { x.profile.labels.yTicks = e.target.checked; })} /></Row>
          <Row label="Distance ticks"><input type="checkbox" checked={p.profile.labels.xTicks} onChange={(e) => set((x) => { x.profile.labels.xTicks = e.target.checked; })} /></Row>
          <Row label="Label size"><input type="number" min={5} max={30} value={p.profile.labels.sizePt} onChange={(e) => set((x) => { x.profile.labels.sizePt = +e.target.value || 9; })} /></Row>
        </>)}
        </Group>)}

        <Group id="north" title="North arrow" {...gp('north')}
          toggle={{ on: p.north.enabled, onChange: (v) => set((x) => { x.north.enabled = v; }) }}>
        {p.north.enabled && (<>
          <Row label="Style">
            <select value={p.north.style} onChange={(e) => set((x) => { x.north.style = e.target.value as NorthStyle; })}>
              <option value="arrow">North arrow</option><option value="circle">Circled arrow</option>
              <option value="compass">Compass (N E S W)</option><option value="rose">Compass rose</option>
            </select>
          </Row>
          <Row label="Position">
            <select value={p.north.corner} onChange={(e) => set((x) => { x.north.corner = e.target.value as Corner; })}>
              <option value="tl">Top left</option><option value="tr">Top right</option>
              <option value="bl">Bottom left</option><option value="br">Bottom right</option>
            </select>
          </Row>
          <Row label="Size"><input type="range" min={8} max={70} step={1} value={p.north.sizeMm} onChange={(e) => set((x) => { x.north.sizeMm = +e.target.value; })} /><span>{p.north.sizeMm} mm</span></Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.north.pen} onChange={(id) => set((x) => { x.north.pen = id!; })} /></Row>
          <Row label="Line weight"><input type="range" min={0.1} max={1} step={0.05} value={p.north.weightMm} onChange={(e) => set((x) => { x.north.weightMm = +e.target.value; })} /></Row>
        </>)}

        </Group>

        <div className="side-stage">Text</div>
        <Group id="typography" title="Typography" {...gp('typography')}>
        <Row label="Font">
          <select value={p.text.font} onChange={(e) => set((x) => { x.text.font = e.target.value as FontKey; })}>
            <option value="sans">Sans-serif</option><option value="serif">Serif</option>
          </select>
        </Row>
        <Row label="Tracking"><input type="range" min={0} max={0.5} step={0.01} value={p.text.trackingEm} onChange={(e) => set((x) => { x.text.trackingEm = +e.target.value; })} /></Row>
        <Row label="Align">
          <select value={p.text.align} onChange={(e) => set((x) => { x.text.align = e.target.value as Align; })}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Row>

        <h3>Title</h3>
        <div className="field">
          <Row label="Text"><input type="text" data-edit="title" placeholder={auto.title} value={p.text.title.value ?? ''} onChange={(e) => set((x) => { x.text.title.value = e.target.value || undefined; })} />
            <input type="checkbox" title="Show" checked={p.text.title.visible} onChange={(e) => set((x) => { x.text.title.visible = e.target.checked; })} /></Row>
          <Row label="Size (pt)"><input type="number" min={6} max={200} value={p.text.title.sizePt} onChange={(e) => set((x) => { x.text.title.sizePt = +e.target.value || 12; })} /></Row>
          <Row label="Align">
            <select value={p.text.title.align} onChange={(e) => set((x) => { x.text.title.align = e.target.value as typeof p.text.title.align; })}>
              <option value="inherit">Same as the other text</option>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
              <option value="justify">Justified (fill the width)</option>
            </select>
          </Row>
          <Row label="Style">
            <select value={p.text.title.style} onChange={(e) => set((x) => { x.text.title.style = e.target.value as typeof p.text.title.style; })}>
              <option value="fill">Filled letters</option>
              <option value="outline">Outline only</option>
              <option value="outlineFill">Outline with fill</option>
            </select>
          </Row>
          <Row label={p.text.title.style === 'fill' ? 'Pen' : 'Outline pen'}><PenSelect pens={p.pens} value={p.text.title.pen} onChange={(id) => set((x) => { x.text.title.pen = id!; })} /></Row>
          {p.text.title.style !== 'fill' && (
            <Row label="Outline weight"><input type="number" min={0.1} max={3} step={0.05} value={p.text.title.outlineMm} onChange={(e) => set((x) => { x.text.title.outlineMm = Math.max(0.1, +e.target.value || 0.35); })} /><span className="unit">mm</span></Row>
          )}
          {p.text.title.style !== 'outline' && (<>
            {p.text.title.style === 'outlineFill' && <Row label="Fill pen"><PenSelect pens={p.pens} value={p.text.title.fillPen} onChange={(id) => set((x) => { x.text.title.fillPen = id!; })} /></Row>}
            <Row label="Fill (plotter)">
              <select value={p.text.title.fillDensity} onChange={(e) => set((x) => { x.text.title.fillDensity = e.target.value as typeof p.text.title.fillDensity; })}>
                <option value="solid">Solid hatching</option><option value="medium">Medium hatching</option><option value="light">Light hatching</option>
              </select>
            </Row>
          </>)}
          <PlaceRow value={p.text.title.placement} onChange={(v) => set((x) => { x.text.title.placement = v; })} />
        </div>

        <h3>Location</h3>
        <div className="field">
          <Row label="Text"><input type="text" data-edit="location" placeholder={auto.location || 'e.g. Washington, USA'} value={p.text.location.value ?? ''} onChange={(e) => set((x) => { x.text.location.value = e.target.value || undefined; })} />
            <input type="checkbox" title="Show" checked={p.text.location.visible} onChange={(e) => set((x) => { x.text.location.visible = e.target.checked; })} /></Row>
          <Row label="Coordinates"><input type="checkbox" checked={p.text.location.showCoords} onChange={(e) => set((x) => { x.text.location.showCoords = e.target.checked; })} /></Row>
          <Row label="Size (pt)"><input type="number" min={6} max={120} value={p.text.location.sizePt} onChange={(e) => set((x) => { x.text.location.sizePt = +e.target.value || 12; })} /></Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.text.location.pen} onChange={(id) => set((x) => { x.text.location.pen = id!; })} /></Row>
          <PlaceRow value={p.text.location.placement} onChange={(v) => set((x) => { x.text.location.placement = v; })} />
        </div>

        <h3>Route info</h3>
        <div className="field">
          <Row label="Show"><input type="checkbox" data-edit="info" checked={p.text.info.visible} onChange={(e) => set((x) => { x.text.info.visible = e.target.checked; })} /></Row>
          <Row label="Layout">
            <select value={p.text.info.layout} onChange={(e) => set((x) => { x.text.info.layout = e.target.value as 'row' | 'column'; })}>
              <option value="row">Row</option><option value="column">Column</option>
            </select>
          </Row>
          <Row label="Size (pt)"><input type="number" min={6} max={120} value={p.text.info.sizePt} onChange={(e) => set((x) => { x.text.info.sizePt = +e.target.value || 12; })} /></Row>
          <Row label="Pen"><PenSelect pens={p.pens} value={p.text.info.pen} onChange={(id) => set((x) => { x.text.info.pen = id!; })} /></Row>
          <PlaceRow value={p.text.info.placement} onChange={(v) => set((x) => { x.text.info.placement = v; })} />
          {p.text.info.items.map((it, i) => (
            <div className="item" key={it.key}>
              <input type="checkbox" title="Show" checked={it.visible} onChange={(e) => set((x) => { x.text.info.items[i]!.visible = e.target.checked; })} />
              <input type="text" title="Label" value={it.label} onChange={(e) => set((x) => { x.text.info.items[i]!.label = e.target.value; })} />
              <input type="text" title="Value" placeholder={auto.info[it.key] || 'auto'} value={it.value ?? ''} onChange={(e) => set((x) => { x.text.info.items[i]!.value = e.target.value || undefined; })} />
              <button title="Move up" disabled={i === 0} onClick={() => set((x) => { const a = x.text.info.items; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; })}>↑</button>
            </div>
          ))}
        </div>

        </Group>

        <div className="side-stage">Page</div>
        <Group id="size" title="Print size" {...gp('size')}>
        <Row label="Size">
          <select value={p.sizeId} onChange={(e) => set((x) => { x.sizeId = e.target.value; })}>
            {(['US (inches)', 'ISO (A series)', 'Metric (cm)'] as SizeGroup[]).map((g) => (
              <optgroup key={g} label={g}>
                {PRINT_SIZES.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </optgroup>
            ))}
            <option value={CUSTOM_SIZE_ID}>Custom size…</option>
          </select>
        </Row>
        {p.sizeId === CUSTOM_SIZE_ID && (() => {
          const inches = p.units === 'imperial';
          const conv = inches ? 25.4 : 10; // mm per displayed unit (in or cm)
          const show = (mm: number) => +(mm / conv).toFixed(2);
          const lim = (mm: number) => +(mm / conv).toFixed(1);
          const edit = (k: 'wMm' | 'hMm') => (e: React.ChangeEvent<HTMLInputElement>) => set((x) => { x.customSize[k] = Math.min(CUSTOM_SIZE_MAX_MM, Math.max(CUSTOM_SIZE_MIN_MM, (+e.target.value || 0) * conv)); });
          return (<>
            <Row label="Width"><input type="number" step={inches ? 0.5 : 1} min={lim(CUSTOM_SIZE_MIN_MM)} max={lim(CUSTOM_SIZE_MAX_MM)} value={show(p.customSize.wMm)} onChange={edit('wMm')} /><span className="unit">{inches ? 'in' : 'cm'}</span></Row>
            <Row label="Height"><input type="number" step={inches ? 0.5 : 1} min={lim(CUSTOM_SIZE_MIN_MM)} max={lim(CUSTOM_SIZE_MAX_MM)} value={show(p.customSize.hMm)} onChange={edit('hMm')} /><span className="unit">{inches ? 'in' : 'cm'}</span></Row>
            <div className="hint">Between {lim(CUSTOM_SIZE_MIN_MM)} and {lim(CUSTOM_SIZE_MAX_MM)} {inches ? 'in' : 'cm'}. Width and height are for a portrait page; use Orientation to turn it.</div>
          </>);
        })()}
        <Row label="Orientation">
          <select value={p.landscape ? 'l' : 'p'} onChange={(e) => set((x) => { x.landscape = e.target.value === 'l'; })}>
            <option value="p">Portrait</option><option value="l">Landscape</option>
          </select>
        </Row>
        <Row label="Units">
          <select value={p.units} onChange={(e) => set((x) => { x.units = e.target.value as typeof p.units; })}>
            <option value="imperial">mi / ft</option><option value="metric">km / m</option>
          </select>
        </Row>

        </Group>

        <PagePanel project={p} margins={gp('margins')} border={gp('border')} />

        <div className="side-stage">Pens and output</div>
        <PensPanel project={p} scene={scene} group={gp('pens')} openGroup={(g) => { gp.show(g); setPendingEdit(`#group-${g} .group-title button`); }} />

        <Group id="export" title="Export" {...gp('export')}>
        <Row label="Watermark">
          <label><input type="checkbox" data-edit="watermark" checked={p.showWatermark} onChange={(e) => set((x) => { x.showWatermark = e.target.checked; })} /> Include attribution</label>
        </Row>
        {p.showWatermark && <Row label="Watermark pen"><PenSelect pens={p.pens} value={p.watermarkPen} onChange={(id) => set((x) => { x.watermarkPen = id!; })} /></Row>}
        <Row label="Paper color">
          <label><input type="checkbox" checked={paperInExport} onChange={(e) => setPaperInExport(e.target.checked)} /> Include in SVG</label>
        </Row>
        <Row label="SVG for">
          <select value={mode} onChange={(e) => setMode(e.target.value as ExportMode)}>
            <option value="plotter">Pen plotter: a layer per pen, lines only</option>
            <option value="print">Print or design: filled shapes, a layer per color</option>
            <option value="live">Design with live text (needs fonts)</option>
          </select>
        </Row>
        {mode === 'plotter' && (<>
          <Row label="Text">
            <select value={plotText} onChange={(e) => setPlotText(e.target.value as PlotterText)}>
              <option value="auto">Single strokes for small text, filled letters for large</option>
              <option value="single">Single strokes for all text</option>
              <option value="outline">Outlined and filled letters for all text</option>
            </select>
          </Row>
          <div className="hint">Single strokes draw each letter as a few lines of the pen: fast, and small labels stay readable. Filled letters are outlined and hatched: heavier, but small ones clot with a wide pen.</div>
          <div className="hint">
            One layer per pen, named after it and in the order of the Pens list, so a layer is a pen to load. Nothing is filled: letters and shapes are outlined, and filled with hatch lines in the same pen. Every line is drawn with its pen's tip width. Heavier lines are repeated side by side:{' '}
            {passes.length ? passes.map((x) => `${x.widthMm} mm = ${x.passes} passes${x.forced ? ' (kept heavier than the rest)' : ''}`).join(', ') : 'none with these pens'}.
          </div>
        </>)}
        <Row label="PNG">
          <select value={dpi} onChange={(e) => setDpi(+e.target.value)}>
            {[72, 150, 300].map((d) => <option key={d} value={d}>{d} dpi</option>)}
          </select>
        </Row>
        {(() => {
          const s = pngSize(scene.widthMm, scene.heightMm, dpi);
          return <div className="hint">{s.width} × {s.height} px{s.capped ? ` (reduced to ${s.dpi} dpi, the largest this browser can render)` : ''}</div>;
        })()}
        <div className="hint">Download the SVG and PNG from the bar above the poster; they follow these settings.</div>
        <div className="row">
          <button type="button" disabled={linkBusy} title="Put this SVG on the server and copy a link to it that works for one hour, to open it on another computer" onClick={async () => {
            setLinkBusy(true); setLinkMsg('Making the link…');
            try {
              const { url, expiresAt } = await createShareLink(await makeSvg());
              const until = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              try { await navigator.clipboard.writeText(url); setLinkMsg(`Link copied. Works until ${until}.`); } catch { setLinkMsg(`${url} (works until ${until})`); }
            } catch (e) {
              setLinkMsg(e instanceof Error ? e.message : 'Could not make the link.');
            } finally { setLinkBusy(false); }
          }}>Copy 1-hour link</button>
        </div>
        {linkMsg && <div className="hint">{linkMsg}</div>}
        </Group>

        <SaveGroup gp={gp('saved')} s={saver} />
      </div>
      <main className="main" id="preview" tabIndex={-1} hidden={narrow && tab !== 'poster'} {...(narrow ? { role: 'tabpanel', 'aria-labelledby': 'tab-poster' } : {})}>
        <div className="actionbar">
          <div className="bar">
            <span className="seg" role="radiogroup" aria-label="Preview">
              <button type="button" role="radio" aria-checked={!plotPreview} className={plotPreview ? '' : 'on'} title="The design, with click-to-edit labels" onClick={() => setPlotPreview(false)}>Design</button>
              <button type="button" role="radio" aria-checked={plotPreview} className={plotPreview ? 'on' : ''} title="How the pens will draw it: hatched fills, passes, ink width and translucency" onClick={() => setPlotPreview(true)}>Plotter</button>
            </span>
            <span className="bar-status hint" aria-live="polite">{plotPreview ? (plotSvg ? 'Click-to-edit is off here' : 'Drawing…') : hovered ? `Click to edit: ${hovered}` : 'Click any part of the poster to edit it'}</span>
            <span className="bar-actions">
              {saver.mine && saver.code && (
                <button type="button" disabled={!!saver.busy} onClick={() => void saver.save(true)} title={`Replace the saved copy under ${saver.code}: the same code and link, with these changes`}>
                  {saver.busy === 'Saving…' ? 'Saving…' : saver.changed ? 'Save over*' : 'Save over'}
                </button>
              )}
              <button type="button" disabled={!!saver.busy} onClick={() => void saver.save()} title="Save the whole poster under a new code you can open again">
                {saver.busy === 'Saving…' && !saver.mine ? 'Saving…' : saver.mine ? 'Save as new' : saver.changed ? 'Save*' : 'Save'}
              </button>
              <button type="button" className="primary" disabled={svgBusy} onClick={() => void downloadSvg()}
                title={`${mode === 'plotter' ? 'Pen plotter SVG: a layer per pen, lines only' : mode === 'print' ? 'SVG for print or design: filled shapes, a layer per color' : 'SVG with live text'}. Change it under Export.`}>
                {svgBusy ? 'Preparing…' : `SVG · ${mode === 'plotter' ? 'plotter' : mode === 'print' ? 'print' : 'live text'}`}
              </button>
              <button type="button" disabled={pngBusy} onClick={() => void downloadPng()} title={`PNG at ${dpi} dpi. Change it under Export.`}>
                {pngBusy ? 'Rendering…' : `PNG · ${dpi} dpi`}
              </button>
            </span>
          </div>
          {exportErr && <div className="err" role="alert">{exportErr}</div>}
          {!exportErr && saver.msg && (
            <div className={saver.msg.error ? 'err' : 'hint'} role={saver.msg.error ? 'alert' : 'status'}>
              {saver.msg.text}
              {!saver.msg.error && saver.code && <> <button type="button" className="link" onClick={() => saver.copy(linkFor(saver.code))}>Copy link</button></>}
            </div>
          )}
        </div>
        <div className="stage">
          <div className="sheet" role="img" aria-label="Preview of the poster" onClick={editAt}
            onMouseOver={(e) => setHovered(plotPreview ? '' : clickTarget(e.target)?.label ?? '')} onMouseLeave={() => setHovered('')} dangerouslySetInnerHTML={{ __html: previewSvg }} />
        </div>
      </main>
      {footer}
    </div>
  );
}
