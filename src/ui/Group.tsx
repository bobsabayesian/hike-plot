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

/** A section of settings that opens and closes: the heading holds a button that shows or hides the body. */
export function Group({ id, title, open, onToggle, swatch, children }: GroupProps & { id: string; title: string; swatch?: string; children: ReactNode }) {
  return (
    <section className="group" id={`group-${id}`}>
      <h2 className="group-title">
        <button type="button" aria-expanded={open} aria-controls={`group-body-${id}`} onClick={onToggle}>
          <span className="chevron" aria-hidden="true">▸</span>
          {swatch && <span className="swatch" aria-hidden="true" style={{ background: swatch }} />}
          <span>{title}</span>
        </button>
      </h2>
      <div className="group-body" id={`group-body-${id}`} hidden={!open}>{children}</div>
    </section>
  );
}
