import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { parseGpx, parseWaypoints } from '../gpx/parse';
import { sampleTrack, sampleWaypoints } from '../sample';
import { KIND_LABELS, LANDMARK_KINDS, type Side } from '../features/types';
import { composeScene, viewBBox, autoValues } from '../scene/buildScene';
import { computeStats } from '../geo/stats';
import { covers, loadTerrain, padBBox } from '../topo/terrain';
import { sceneToSvg } from '../export/svg';
import { pngSize, sceneToPng } from '../export/png';
import { loadFonts } from '../export/fonts';
import { prepareScene, type ExportMode } from '../export/outlines';
import { PRINT_SIZES, type Align, type FontKey, type Placement, type StrokeStyle } from '../scene/project';

const PlaceRow = ({ value, onChange }: { value: Placement; onChange: (v: Placement) => void }) => (
  <Row label="Position">
    <select value={value} onChange={(e) => onChange(e.target.value as Placement)}>
      <option value="top">Top</option><option value="bottom">Bottom</option>
    </select>
  </Row>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="row"><label>{label}</label>{children}</div>
);

function download(name: string, data: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const { project: p, set, terrain, terrainStatus, terrainError, setTerrain, loadPoints, osm, osmStatus, osmError, loadOsm, searchFeature, busy, notice } = useStore();
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [paperInExport, setPaperInExport] = useState(false);
  const [mode, setMode] = useState<ExportMode>('print');
  const [dpi, setDpi] = useState(150);
  const [pngBusy, setPngBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const composed = useMemo(() => composeScene(p, terrain, osm), [p, terrain, osm]);
  const scene = composed.scene;
  const need = useMemo(() => viewBBox(p), [p]);
  const auto = useMemo(() => autoValues(p, p.points.length ? computeStats(p.points) : undefined), [p]);

  // Fetch landmarks/water whenever the visible area is not covered by what we already have.
  useEffect(() => {
    if (!p.features.enabled || !need) return;
    const c = osm?.covers;
    if (c && need.minLat >= c.minLat && need.maxLat <= c.maxLat && need.minLon >= c.minLon && need.maxLon <= c.maxLon) return;
    const t = setTimeout(() => loadOsm(padBBox(need, 0.05)), 600);
    return () => clearTimeout(t);
  }, [need, p.features.enabled, osm, loadOsm]);

  // Fetch terrain whenever the visible map area is not covered by what we already have.
  useEffect(() => {
    if (!p.terrain.enabled || !need) return;
    if (terrain && covers(terrain, need)) return;
    let live = true;
    const t = setTimeout(() => {
      useStore.setState({ terrainStatus: 'loading' });
      loadTerrain(padBBox(need, 0.1))
        .then((field) => live && setTerrain(field, 'idle'))
        .catch((e) => live && setTerrain(undefined, 'error', e instanceof Error ? e.message : 'Terrain failed'));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [need, p.terrain.enabled, terrain, setTerrain]);
  const previewSvg = useMemo(() => sceneToSvg(scene, { paper: true }), [scene]);

  async function load(file?: File) {
    if (!file) return;
    try {
      const xml = await file.text();
      loadPoints(parseGpx(xml), true, parseWaypoints(xml));
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read file');
    }
  }

  return (
    <div className="app">
      <aside className="panel">
        <h1>HIKE PLOT</h1>
        <div
          className={`drop${over ? ' over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}
        >
          Drop a .gpx file here, or click to browse
          <input ref={input} type="file" accept=".gpx" hidden onChange={(e) => load(e.target.files?.[0])} />
        </div>
        <div className="row"><button onClick={() => { const t = sampleTrack(); loadPoints(t, false, sampleWaypoints(t)); }}>Use sample route</button></div>
        {err && <div className="err">{err}</div>}
        <h2>Or search a feature</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (query.trim()) searchFeature(query.trim()); }}>
          <input type="text" placeholder="e.g. Mount Rainier" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button disabled={!!busy}>{busy || 'Go'}</button>
        </form>
        {notice && <div className="err">{notice}</div>}

        <h2>Print size</h2>
        <Row label="Size">
          <select value={p.sizeId} onChange={(e) => set((x) => { x.sizeId = e.target.value; })}>
            {PRINT_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Row>
        <Row label="Orientation">
          <select value={p.landscape ? 'l' : 'p'} onChange={(e) => set((x) => { x.landscape = e.target.value === 'l'; })}>
            <option value="p">Portrait</option><option value="l">Landscape</option>
          </select>
        </Row>
        <Row label="Paper"><input type="color" value={p.paper} onChange={(e) => set((x) => { x.paper = e.target.value; })} /></Row>
        <Row label="Units">
          <select value={p.units} onChange={(e) => set((x) => { x.units = e.target.value as typeof p.units; })}>
            <option value="imperial">mi / ft</option><option value="metric">km / m</option>
          </select>
        </Row>

        <h2>Route</h2>
        <Row label="Color"><input type="color" value={p.route.color} onChange={(e) => set((x) => { x.route.color = e.target.value; })} /></Row>
        <Row label="Weight">
          <input type="range" min={0.2} max={3} step={0.1} value={p.route.weightMm} onChange={(e) => set((x) => { x.route.weightMm = +e.target.value; })} />
          <span>{p.route.weightMm.toFixed(1)} mm</span>
        </Row>
        <Row label="Style">
          <select value={p.route.style} onChange={(e) => set((x) => { x.route.style = e.target.value as StrokeStyle; })}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
        </Row>

        <h2>Contours</h2>
        <Row label="Show"><input type="checkbox" checked={p.terrain.enabled} onChange={(e) => set((x) => { x.terrain.enabled = e.target.checked; })} />
          <span>{terrainStatus === 'loading' ? 'Loading terrain…' : ''}</span></Row>
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
          <Row label="Color"><input type="color" value={p.terrain.color} onChange={(e) => set((x) => { x.terrain.color = e.target.value; })} /></Row>
          <Row label="Weight"><input type="range" min={0.05} max={0.6} step={0.01} value={p.terrain.weightMm} onChange={(e) => set((x) => { x.terrain.weightMm = +e.target.value; x.terrain.indexWeightMm = +e.target.value * 2; })} /></Row>
          <Row label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={p.terrain.opacity} onChange={(e) => set((x) => { x.terrain.opacity = +e.target.value; })} /></Row>
        </>)}

        <h2>Landmarks</h2>
        <Row label="Show">
          <input type="checkbox" checked={p.features.enabled} onChange={(e) => set((x) => { x.features.enabled = e.target.checked; })} />
          <span>{osmStatus === 'loading' ? 'Loading landmarks…' : ''}</span>
        </Row>
        {osmError && <div className="err">{osmError}</div>}
        {p.features.enabled && (<>
          <Row label="Max labels"><input type="range" min={0} max={20} step={1} value={p.features.maxLabels} onChange={(e) => set((x) => { x.features.maxLabels = +e.target.value; })} /><span>{p.features.maxLabels}</span></Row>
          <div className="kinds">
            {LANDMARK_KINDS.map((k) => (
              <label key={k}><input type="checkbox" checked={p.features.kinds[k]} onChange={(e) => set((x) => { x.features.kinds[k] = e.target.checked; })} /> {KIND_LABELS[k]}</label>
            ))}
            <label><input type="checkbox" checked={p.features.water} onChange={(e) => set((x) => { x.features.water = e.target.checked; })} /> Rivers &amp; lake outlines</label>
          </div>
          <Row label="Size (pt)"><input type="number" min={6} max={60} value={p.features.sizePt} onChange={(e) => set((x) => { x.features.sizePt = +e.target.value || 11; })} /></Row>
          <Row label="Label color"><input type="color" value={p.features.color} onChange={(e) => set((x) => { x.features.color = e.target.value; })} /></Row>
          <Row label="Water color"><input type="color" value={p.features.waterColor} onChange={(e) => set((x) => { x.features.waterColor = e.target.value; })} /></Row>
          {composed.landmarks?.map((l) => {
            const ov = p.features.overrides[l.id] ?? {};
            const edit = (patch: Partial<typeof ov>) => set((x) => { x.features.overrides[l.id] = { ...x.features.overrides[l.id], ...patch }; });
            return (
              <div className="lm" key={l.id}>
                <input type="checkbox" title="Show" checked={!l.hidden} onChange={(e) => edit({ hidden: !e.target.checked })} />
                <input type="text" title={KIND_LABELS[l.kind]} value={ov.name ?? l.name} onChange={(e) => edit({ name: e.target.value })} />
                <select title="Label side" value={ov.side ?? 'auto'} disabled={l.kind === 'lake'} onChange={(e) => edit({ side: e.target.value as Side })}>
                  <option value="auto">Auto</option><option value="right">Right</option><option value="left">Left</option>
                  <option value="above">Above</option><option value="below">Below</option>
                </select>
                {!l.placed && !l.hidden && <span className="hint" title="No room for this label">no room</span>}
              </div>
            );
          })}
        </>)}

        <h2>Elevation profile</h2>
        <Row label="Show"><input type="checkbox" checked={p.profile.enabled} onChange={(e) => set((x) => { x.profile.enabled = e.target.checked; })} /></Row>
        {p.profile.enabled && (<>
          <Row label="Position">
            <select value={p.profile.position} onChange={(e) => set((x) => { x.profile.position = e.target.value as typeof p.profile.position; })}>
              <option value="bottom">Bottom</option><option value="corner">Bottom corner</option>
            </select>
          </Row>
          <Row label="Fill"><input type="color" value={p.profile.fill} onChange={(e) => set((x) => { x.profile.fill = e.target.value; })} /></Row>
          <Row label="Stroke"><input type="color" value={p.profile.stroke} onChange={(e) => set((x) => { x.profile.stroke = e.target.value; })} /></Row>
          <Row label="Opacity"><input type="range" min={0} max={1} step={0.02} value={p.profile.opacity} onChange={(e) => set((x) => { x.profile.opacity = +e.target.value; })} /></Row>
        </>)}

        <h2>Typography</h2>
        <Row label="Font">
          <select value={p.text.font} onChange={(e) => set((x) => { x.text.font = e.target.value as FontKey; })}>
            <option value="sans">Sans-serif</option><option value="serif">Serif</option>
          </select>
        </Row>
        <Row label="Color"><input type="color" value={p.text.color} onChange={(e) => set((x) => { x.text.color = e.target.value; })} /></Row>
        <Row label="Tracking"><input type="range" min={0} max={0.5} step={0.01} value={p.text.trackingEm} onChange={(e) => set((x) => { x.text.trackingEm = +e.target.value; })} /></Row>
        <Row label="Align">
          <select value={p.text.align} onChange={(e) => set((x) => { x.text.align = e.target.value as Align; })}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Row>

        <h3>Title</h3>
        <div className="field">
          <Row label="Text"><input type="text" placeholder={auto.title} value={p.text.title.value ?? ''} onChange={(e) => set((x) => { x.text.title.value = e.target.value || undefined; })} />
            <input type="checkbox" title="Show" checked={p.text.title.visible} onChange={(e) => set((x) => { x.text.title.visible = e.target.checked; })} /></Row>
          <Row label="Size (pt)"><input type="number" min={6} max={200} value={p.text.title.sizePt} onChange={(e) => set((x) => { x.text.title.sizePt = +e.target.value || 12; })} /></Row>
          <PlaceRow value={p.text.title.placement} onChange={(v) => set((x) => { x.text.title.placement = v; })} />
        </div>

        <h3>Location</h3>
        <div className="field">
          <Row label="Text"><input type="text" placeholder={auto.location || 'e.g. Washington, USA'} value={p.text.location.value ?? ''} onChange={(e) => set((x) => { x.text.location.value = e.target.value || undefined; })} />
            <input type="checkbox" title="Show" checked={p.text.location.visible} onChange={(e) => set((x) => { x.text.location.visible = e.target.checked; })} /></Row>
          <Row label="Coordinates"><input type="checkbox" checked={p.text.location.showCoords} onChange={(e) => set((x) => { x.text.location.showCoords = e.target.checked; })} /></Row>
          <Row label="Size (pt)"><input type="number" min={6} max={120} value={p.text.location.sizePt} onChange={(e) => set((x) => { x.text.location.sizePt = +e.target.value || 12; })} /></Row>
          <PlaceRow value={p.text.location.placement} onChange={(v) => set((x) => { x.text.location.placement = v; })} />
        </div>

        <h3>Route info</h3>
        <div className="field">
          <Row label="Show"><input type="checkbox" checked={p.text.info.visible} onChange={(e) => set((x) => { x.text.info.visible = e.target.checked; })} /></Row>
          <Row label="Layout">
            <select value={p.text.info.layout} onChange={(e) => set((x) => { x.text.info.layout = e.target.value as 'row' | 'column'; })}>
              <option value="row">Row</option><option value="column">Column</option>
            </select>
          </Row>
          <Row label="Size (pt)"><input type="number" min={6} max={120} value={p.text.info.sizePt} onChange={(e) => set((x) => { x.text.info.sizePt = +e.target.value || 12; })} /></Row>
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

        <h2>Export</h2>
        <Row label="Watermark">
          <label><input type="checkbox" checked={p.showWatermark} onChange={(e) => set((x) => { x.showWatermark = e.target.checked; })} /> Include attribution</label>
        </Row>
        <Row label="Paper color">
          <label><input type="checkbox" checked={paperInExport} onChange={(e) => setPaperInExport(e.target.checked)} /> Include in SVG</label>
        </Row>
        <Row label="SVG text">
          <select value={mode} onChange={(e) => setMode(e.target.value as ExportMode)}>
            <option value="print">Outlined, filled (print)</option>
            <option value="plotter">Outlined, single-line pen (plotter)</option>
            <option value="live">Live text (needs fonts)</option>
          </select>
        </Row>
        <div className="row">
          <button className="primary" onClick={async () => {
            try {
              const out = prepareScene(scene, mode, mode === 'live' ? undefined : await loadFonts());
              download('hike-poster.svg', sceneToSvg(out, { paper: paperInExport && mode !== 'plotter' }), 'image/svg+xml');
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'SVG export failed');
            }
          }}>
            Download SVG (layer per color)
          </button>
        </div>
        <Row label="PNG">
          <select value={dpi} onChange={(e) => setDpi(+e.target.value)}>
            {[72, 150, 300].map((d) => <option key={d} value={d}>{d} dpi</option>)}
          </select>
          <button
            disabled={pngBusy}
            onClick={async () => {
              setPngBusy(true);
              try {
                const { blob } = await sceneToPng(scene, dpi);
                download('hike-poster.png', blob, 'image/png');
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'PNG export failed');
              } finally {
                setPngBusy(false);
              }
            }}
          >
            {pngBusy ? 'Rendering…' : 'Download PNG'}
          </button>
        </Row>
        {(() => {
          const s = pngSize(scene.widthMm, scene.heightMm, dpi);
          return <div className="hint">{s.width} × {s.height} px{s.capped ? ` (reduced to ${s.dpi} dpi, the largest this browser can render)` : ''}</div>;
        })()}
      </aside>
      <main className="stage">
        <div className="sheet" dangerouslySetInnerHTML={{ __html: previewSvg }} />
      </main>
    </div>
  );
}
