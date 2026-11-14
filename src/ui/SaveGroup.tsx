import { useEffect, useRef, useState } from 'react';
import { Group, type GroupProps } from './Group';
import { loadProject, saveProject, type ProjectMeta } from '../projectFile';
import { cleanCode } from '../../worker/projects';
import type { Project } from '../scene/project';

export const linkFor = (code: string) => `${location.origin}/?p=${code}`;

export type SaveMsg = { text: string; error?: boolean } | null;

/**
 * Saving the whole poster (settings, GPX track and waypoints) under a short code, and opening one by its code.
 * Used by both the action bar (Save) and the start screen and sidebar (Open), so it lives in one place.
 */
export function useProjectSave({ project, openProject, meta, thumb }: { project: Project; openProject: (p: Project) => void; meta?: ProjectMeta; thumb?: () => Promise<Blob> }) {
  const [code, setCode] = useState('');
  /** the project as it was when last saved or opened, to tell whether there are changes since */
  const [savedAs, setSavedAs] = useState<Project | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<SaveMsg>(null);
  const started = useRef(false);

  const open = async (raw: string) => {
    const c = cleanCode(raw);
    if (!c) { setMsg({ text: 'That is not a project code (8 letters and numbers).', error: true }); return; }
    setBusy('Opening…'); setMsg(null);
    try {
      const p = await loadProject(c);
      openProject(p);
      setCode(c);
      setSavedAs(p);
      history.replaceState(null, '', `?p=${c}`);
      setMsg({ text: `Opened ${c}.` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not open', error: true });
    } finally { setBusy(''); }
  };

  // a link with ?p=code opens that project straight away
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const c = new URLSearchParams(location.search).get('p');
    if (c) void open(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy('Saving…'); setMsg(null);
    try {
      const c = await saveProject(project, meta, thumb);
      setCode(c);
      setSavedAs(project);
      history.replaceState(null, '', `?p=${c}`);
      setMsg({ text: `Saved as ${c}. Anyone with this code can open it, so share it only with people who may see the track.` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not save', error: true });
    } finally { setBusy(''); }
  };

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => setMsg({ text: 'Copied.' }), () => {}); };

  /** edited since the last save or open: the code (and the ?p= link) point at the older copy */
  const changed = !!code && savedAs !== project;
  return { code, busy, msg, setMsg, open, save, copy, changed };
}

export type ProjectSave = ReturnType<typeof useProjectSave>;

/** Type a project code (or paste a link) and open it. */
export function OpenByCode({ s }: { s: ProjectSave }) {
  const [typed, setTyped] = useState('');
  return (
    <div className="row">
      <input type="text" aria-label="Project code" placeholder="Project code or link" value={typed} onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void s.open(typed); }} />
      <button type="button" onClick={() => void s.open(typed)} disabled={!!s.busy || !typed.trim()}>Open</button>
    </div>
  );
}

/** The sidebar group: the current code with copy buttons, and opening another project. Saving is in the action bar. */
export function SaveGroup({ gp, s }: { gp: GroupProps; s: ProjectSave }) {
  return (
    <Group id="saved" title="Saved project" {...gp}>
      {s.code ? (
        <div className="row">
          <b className="code" title="Project code">{s.code}</b>
          <button type="button" onClick={() => s.copy(s.code)}>Copy code</button>
          <button type="button" onClick={() => s.copy(linkFor(s.code))}>Copy link</button>
        </div>
      ) : <div className="hint">Not saved yet. Use Save above the poster.</div>}
      {s.changed && <div className="hint">Changed since this code was saved. Save again for a code with the changes.</div>}
      <OpenByCode s={s} />
      {s.msg && <div className={s.msg.error ? 'err' : 'hint'}>{s.msg.text}</div>}
      <div className="hint">Saving keeps all settings, the GPX track and its waypoints. Each save makes a new code; opening one loads that saved copy.</div>
    </Group>
  );
}
