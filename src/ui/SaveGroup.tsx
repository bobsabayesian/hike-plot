import { useEffect, useRef, useState } from 'react';
import { Group, type GroupProps } from './Group';
import { loadProject, saveProject } from '../projectFile';
import { cleanCode } from '../../worker/projects';
import type { Project } from '../scene/project';

const linkFor = (code: string) => `${location.origin}/?p=${code}`;

/** Save the whole poster (settings, GPX track and waypoints) under a short code, and open one by its code. */
export function SaveGroup({ gp, project, openProject }: { gp: GroupProps; project: Project; openProject: (p: Project) => void }) {
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const started = useRef(false);

  const open = async (raw: string) => {
    const c = cleanCode(raw);
    if (!c) { setMsg({ text: 'That is not a project code (8 letters and numbers).', error: true }); return; }
    setBusy('Opening…'); setMsg(null);
    try {
      openProject(await loadProject(c));
      setCode(c);
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
      const c = await saveProject(project);
      setCode(c);
      history.replaceState(null, '', `?p=${c}`);
      setMsg({ text: 'Saved. Anyone with this code can open it, so share it only with people who may see the track.' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not save', error: true });
    } finally { setBusy(''); }
  };

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => setMsg({ text: 'Copied.' }), () => {}); };

  return (
    <Group id="saved" title="Save and open" {...gp}>
      <div className="row">
        <button type="button" onClick={save} disabled={!!busy}>Save project</button>
        <span>{busy}</span>
      </div>
      {code && (
        <div className="row">
          <b className="code" title="Project code">{code}</b>
          <button type="button" onClick={() => copy(code)}>Copy code</button>
          <button type="button" onClick={() => copy(linkFor(code))}>Copy link</button>
        </div>
      )}
      <div className="row">
        <input type="text" aria-label="Project code" placeholder="Project code or link" value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void open(typed); }} />
        <button type="button" onClick={() => void open(typed)} disabled={!!busy || !typed.trim()}>Open</button>
      </div>
      {msg && <div className={msg.error ? 'err' : 'hint'}>{msg.text}</div>}
      <div className="hint">Saving keeps all settings, the GPX track and its waypoints. Each save makes a new code; opening one loads that saved copy.</div>
    </Group>
  );
}
