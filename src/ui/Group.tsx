import { useEffect, useState, type ReactNode } from 'react';

/** Whether a CSS media query currently matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Below this width the settings and the poster no longer fit side by side, so they become two tabs. */
export const NARROW_QUERY = '(max-width: 800px)';

export interface GroupProps { open: boolean; onToggle: () => void }

/**
 * Which groups of settings are open: all closed to begin with. Any number can be open on a desktop; on a narrow
 * screen only one at a time, and it is scrolled to the top of the panel.
 */
export function useGroups(narrow: boolean) {
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const isOpen = (id: string) => (narrow ? openGroups[0] === id : openGroups.includes(id));
  const toggle = (id: string) =>
    setOpenGroups((prev) => (narrow ? (prev[0] === id ? [] : [id]) : prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const firstOpen = openGroups[0];
  useEffect(() => {
    if (narrow && firstOpen) document.getElementById(`group-${firstOpen}`)?.scrollIntoView({ block: 'start' });
  }, [narrow, firstOpen]);
  const gp = (id: string): GroupProps => ({ open: isOpen(id), onToggle: () => toggle(id) });
  /** open a group (and leave it open if it already is) */
  gp.show = (id: string) => setOpenGroups((prev) => (narrow ? [id] : prev.includes(id) ? prev : [...prev, id]));
  return gp;
}

/** A part of the poster that can be turned on and off from its group's header. */
export interface Switch { on: boolean; onChange: (on: boolean) => void; /** a short note beside the switch, such as "Loading…" */ status?: string }

/**
 * A section of settings that opens and closes: the heading holds a button that shows or hides the body. A group for a
 * part of the poster that can be left out also has an on/off switch in its header, beside (not inside) that button,
 * so the closed sidebar shows at a glance what is on. While it is off, the body says so instead of its settings.
 */
export function Group({ id, title, open, onToggle, swatch, toggle, children }: GroupProps & { id: string; title: string; swatch?: string; toggle?: Switch; children: ReactNode }) {
  const off = toggle && !toggle.on;
  return (
    <section className={`group${off ? ' off' : ''}`} id={`group-${id}`}>
      <div className="group-head">
        <h2 className="group-title">
          <button type="button" aria-expanded={open} aria-controls={`group-body-${id}`} onClick={onToggle}>
            <span className="chevron" aria-hidden="true">▸</span>
            {swatch && <span className="swatch" aria-hidden="true" style={{ background: swatch }} />}
            <span>{title}</span>
            {off && <span className="sr-only"> (off)</span>}
          </button>
        </h2>
        {toggle && (<>
          {toggle.status && <span className="group-status hint">{toggle.status}</span>}
          <label className="switch" title={toggle.on ? `${title} is on: click to leave it out` : `${title} is off: click to show it`}>
            <input type="checkbox" role="switch" aria-label={`Show ${title.toLowerCase()}`} checked={toggle.on} onChange={(e) => toggle.onChange(e.target.checked)} />
            <span className="track" aria-hidden="true" />
          </label>
        </>)}
      </div>
      <div className="group-body" id={`group-body-${id}`} hidden={!open}>
        {off ? <div className="hint off-note">Off. Turn on the switch above to show it on the poster.</div> : children}
      </div>
    </section>
  );
}
