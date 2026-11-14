import { defaultProject, type Project } from './scene/project';

export const FILE_APP = 'walk-of-frame';
export const FILE_VERSION = 1;

/** What the admin page shows about a project without opening it. Typed by the app at save time and only ever displayed. */
export interface ProjectMeta { title?: string; place?: string; distance?: string; gain?: string; size?: string }

export interface ProjectFile { app: typeof FILE_APP; version: number; savedAt: string; project: Project; meta?: ProjectMeta }

/** Everything needed to rebuild the poster: all settings, the GPX track and its waypoints, and the searched place. */
export const toFile = (p: Project, meta?: ProjectMeta): ProjectFile => ({ app: FILE_APP, version: FILE_VERSION, savedAt: new Date().toISOString(), project: p, ...(meta ? { meta } : {}) });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lay saved values over the defaults, so a project saved before a setting existed still opens (the new setting
 * takes its default). Objects merge key by key; arrays and numbers, strings and so on are taken as saved.
 */
export function mergeDefaults<T>(base: T, saved: unknown): T {
  if (!isObj(base) || !isObj(saved)) return (saved === undefined ? base : (saved as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(saved)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = k in base ? mergeDefaults((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

export function fromFile(raw: unknown): Project {
  if (!isObj(raw) || raw.app !== FILE_APP || !isObj(raw.project)) throw new Error('Not a Walk of Frame project');
  if (typeof raw.version === 'number' && raw.version > FILE_VERSION) throw new Error('This project was saved by a newer version of the app');
  const p = mergeDefaults(defaultProject(), raw.project);
  if (!Array.isArray(p.points)) p.points = [];
  if (!Array.isArray(p.waypoints)) p.waypoints = [];
  if (!Array.isArray(p.pens) || !p.pens.length) p.pens = defaultProject().pens;
  return p;
}

export async function saveProject(p: Project, meta?: ProjectMeta, thumb?: () => Promise<Blob>): Promise<string> {
  const r = await fetch('/api/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toFile(p, meta)) });
  const body = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!r.ok || !body.code) throw new Error(body.error ?? 'Could not save');
  // the small picture for the admin page: the project is saved either way, so a failure here is not an error
  if (thumb) {
    try { await fetch(`/api/project/${body.code}/thumb`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: await thumb() }); } catch { /* no thumbnail */ }
  }
  return body.code;
}

export async function loadProject(code: string): Promise<Project> {
  const r = await fetch(`/api/project/${encodeURIComponent(code)}`);
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not load');
  return fromFile(await r.json());
}
