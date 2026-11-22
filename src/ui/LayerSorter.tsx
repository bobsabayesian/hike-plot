import { useMemo, useState } from 'react';
import { COVER_CLASSES, COVER_LABELS } from '../cover/types';
import { plotRuns } from '../export/svg';
import { beneath, defaultLayers, DEFAULT_GAP_MM, LAYERS, layerLabel, layerOfPart, MAX_GAP_MM, moveLayer, moveLayerTo, setCut, setCutsBelow, setGap, effectiveCuts, starterBlocked, suggestCuts, type LayerId } from '../scene/layers';
import { penFor } from '../scene/pens';
import type { Project } from '../scene/project';
import type { Prim } from '../scene/types';
import { useStore } from '../store';

/** What the other settings already clear in this layer's favor, said in words (read only: they live in their own panels). */
export function existingClears(p: Project, id: LayerId): string[] {
  const out: string[] = [];
  if (id === 'route' && (p.route.clearMm ?? 0) > 0) out.push(`Route settings already clear terrain lines and land cover marks ${p.route.clearMm!.toFixed(1)} mm beside the route.`);
  if (id === 'landmarks' && p.features.enabled && ((p.features.clearMm ?? 0) > 0 || Object.values(p.features.overrides).some((o) => (o.clearMm ?? 0) > 0))) out.push('Landmark settings already clear terrain lines around labels.');
  if (id === 'cover' && p.cover.enabled) {
    const kinds = COVER_CLASSES.filter((c) => p.cover.classes[c].on && (p.cover.classes[c].pattern === 'clear' || (p.cover.classes[c].clearPct ?? 0) > 0))
      .map((c) => `${COVER_LABELS[c]}${p.cover.classes[c].pattern === 'clear' ? '' : ` ${p.cover.classes[c].clearPct}%`}`);
    if (kinds.length) out.push(`Land cover settings already clear terrain lines under ${kinds.join(', ')}.`);
  }
  return out;
}

/**
 * The layer sorter, beside the poster in the plotter view: the order the layers are drawn in (first at the top of the list), and
 * for each layer which layers drawn before it it cuts lines out of. Hovering a row dims the rest of the poster.
 */
export function LayerSorter({ project: p, prims, hovered, onHover, pending, onRedraw }: { project: Project; prims: Prim[]; hovered: LayerId | null; onHover: (id: LayerId | null) => void; pending: boolean; onRedraw: () => void }) {
  const set = useStore((s) => s.set);
  const s = p.layers;
  const [open, setOpen] = useState<LayerId | null>(null);
  const [drag, setDrag] = useState<LayerId | null>(null);
  const change = (fn: (l: typeof s) => typeof s) => set((x) => { x.layers = fn(x.layers); });

  /** the pens each layer draws with, and whether it has anything on the poster */
  const used = useMemo(() => {
    const m = new Map<LayerId, string[]>();
    for (const pr of prims) {
      const l = layerOfPart(pr.part);
      if (!l) continue;
      const pens = m.get(l) ?? [];
      if (pr.pen !== undefined && !pens.includes(pr.pen)) pens.push(pr.pen);
      m.set(l, pens);
    }
    return m;
  }, [prims]);
  const changes = useMemo(() => {
    if (!s.byStack) return Math.max(0, new Set(prims.map((x) => x.pen).filter((x) => x !== undefined)).size - 1);
    return Math.max(0, plotRuns(prims, p.pens, s).length - 1);
  }, [prims, p.pens, s]);
  const cuts = s.order.reduce((n, id) => n + effectiveCuts(s, id).length, 0);

  return (
    <aside className="layers" aria-label="Layers">
      {hovered && <style>{`.sheet svg [data-layer]:not([data-layer="${hovered}"]) { opacity: .12; }`}</style>}
      <div className="layers-head">
        <strong>Layers</strong>
        <button type="button" className="link" disabled={!cuts && !s.byStack && s.order.every((id, i) => id === defaultLayers().order[i])} onClick={() => change(() => defaultLayers())}>Reset</button>
      </div>
      <div className="row">
        <button type="button" onClick={onRedraw} disabled={!pending} title={pending ? 'The preview still shows the earlier order and cuts: redraw it with these' : 'The preview shows the order and cuts below'}>Redraw{pending ? ' *' : ''}</button>
        <span className="hint">{pending ? 'Changes waiting. The plotter file already uses them.' : 'Up to date.'}</span>
      </div>
      <label className="layers-by" title="Off: the file has one layer for each pen, in the pens' order. On: the file's layers follow this order, a layer for each run of one pen.">
        <input type="checkbox" checked={s.byStack} onChange={(e) => change((l) => ({ ...l, byStack: e.target.checked }))} /> Plot in this order
      </label>
      <div className="hint">Tick the box on a row to make that layer cut everything below it.</div>
      <div className="hint">{changes} pen change{changes === 1 ? '' : 's'}{s.byStack ? ' in this order' : ' (one layer per pen)'}. Drawn first at the top; a layer can cut the ones above it.</div>
      <ol className="layer-list">
        {s.order.map((id, i) => {
          const pens = used.get(id);
          const empty = !pens?.length;
          const rule = s.rules[id];
          const below = beneath(s, id);
          const notes = existingClears(p, id);
          const isOpen = open === id;
          return (
            <li key={id} className={`layer${hovered === id ? ' hot' : ''}${empty ? ' empty' : ''}${drag === id ? ' dragging' : ''}`}
              draggable onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (drag) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) change((l) => moveLayerTo(l, drag, i)); setDrag(null); }}
              onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}>
              <div className="layer-row">
                <span className="layer-pens" aria-hidden="true">{(pens ?? []).map((pid) => <span key={pid} className="swatch" style={{ background: penFor(p.pens, pid).color }} title={penFor(p.pens, pid).name} />)}</span>
                <button type="button" className="link layer-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)} title="Show what this layer cuts">
                  {layerLabel(id)}{empty ? ' (nothing here)' : ''}{rule ? (rule.below ? ' · cuts all below' : ` · cuts ${effectiveCuts(s, id).length}`) : ''}
                </button>
                <input type="checkbox" className="layer-below" aria-label={`${layerLabel(id)} cuts all the layers below`} title={below.length ? 'Cut all the layers below this one (follows the order)' : 'Drawn first: nothing below to cut'} disabled={!below.length} checked={!!rule?.below} onChange={(e) => change((l) => setCutsBelow(l, id, e.target.checked))} />
                <button type="button" aria-label={`Draw ${layerLabel(id)} earlier`} title="Earlier" disabled={i === 0} onClick={() => change((l) => moveLayer(l, id, -1))}>↑</button>
                <button type="button" aria-label={`Draw ${layerLabel(id)} later`} title="Later" disabled={i === s.order.length - 1} onClick={() => change((l) => moveLayer(l, id, 1))}>↓</button>
              </div>
              {isOpen && (
                <div className="layer-cuts">
                  {below.length === 0 ? <div className="hint">Drawn first, so there is nothing beneath it to cut.</div> : (<>
                    <label title="Cuts every layer drawn before this one, and keeps doing so when you reorder"><input type="checkbox" checked={!!rule?.below} onChange={(e) => change((l) => setCutsBelow(l, id, e.target.checked))} /> Cut all the layers below</label>
                    {!rule?.below && (<>
                      <div className="hint">Or only the lines of:</div>
                      {below.map((lo) => (
                        <label key={lo}><input type="checkbox" checked={!!rule?.cuts.includes(lo)} onChange={(e) => change((l) => setCut(l, id, lo, e.target.checked))} /> {layerLabel(lo)}</label>
                      ))}
                    </>)}
                    {rule && (
                      <div className="row">
                        <label>Gap</label>
                        <input type="number" min={0} max={MAX_GAP_MM} step={0.1} value={rule.gapMm} onChange={(e) => change((l) => setGap(l, id, +e.target.value))} />
                        <span className="unit">mm</span>
                      </div>
                    )}
                    <div className="hint">The gap is left beside this layer's lines, on top of half the width of its pen ({DEFAULT_GAP_MM} mm to start).</div>
                  </>)}
                  {notes.map((n) => <div className="hint note" key={n}>{n}</div>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="row"><button type="button" onClick={() => change((l) => suggestCuts(l))} title="Wherever the route, north arrow, landmarks and text are over the ground, adds cuts so each clears the terrain lines, land cover and water under it. Your order and the cuts you already set stay; a layer drawn below the ground cannot cut it, so move it up first">Top layers clear what is under them</button></div>
      {starterBlocked(s).length > 0 && <div className="hint">Drawn below some of the ground, so they cannot clear it: {starterBlocked(s).map((l) => layerLabel(l)).join(', ')}. Move them up to include them.</div>}
      <div className="hint">{LAYERS.length} layers. Cuts and order apply to the plotter view and the plotter SVG.</div>
    </aside>
  );
}
