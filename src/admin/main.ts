/** The admin page: every saved project, read-only. All of it sits behind Cloudflare Access (see worker/access.ts). */

interface Project {
  code: string; name: string; place: string; savedAt: string; bytes: number; points: number; waypoints: number;
  distance: string; gain: string; size: string; thumb: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const size = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export const when = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };

/** A new element with its text set as text (names are typed by visitors, so nothing here is ever read as HTML). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function remove(p: Project, row: HTMLElement) {
  const label = p.name ? `${p.name} (${p.code})` : p.code;
  if (!window.confirm(`Delete ${label}?\n\nThis removes the saved project and its picture for good. Anyone opening its code will get "no project with that code".`)) return;
  try {
    const r = await fetch(`/api/admin/project/${encodeURIComponent(p.code)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'x-admin-action': 'delete' } });
    if (!r.ok) throw new Error(String(r.status));
    all = all.filter((x) => x.code !== p.code);
    row.remove();
    refreshTotals();
  } catch (e) {
    window.alert(`Could not delete ${label} (${(e as Error).message}).`);
  }
}

const link = (text: string, href: string) => { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };

let all: Project[] = [];

function refreshTotals() {
  const tot = $('totals');
  tot.replaceChildren();
  for (const [n, label] of [[String(all.length), 'saved projects'], [size(all.reduce((t, p) => t + p.bytes, 0)), 'stored']] as const) {
    const d = el('div'); d.append(el('b', n), el('span', label, 'dim')); tot.append(d);
  }
  $('table').hidden = !all.length;
  $('msg').hidden = all.length > 0;
  if (!all.length) $('msg').textContent = 'No saved projects yet.';
}

function draw() {
  const q = $<HTMLInputElement>('find').value.trim().toLowerCase();
  const rows = $('rows');
  rows.replaceChildren();
  for (const p of all) {
    if (q && !`${p.code} ${p.name} ${p.place} ${p.size}`.toLowerCase().includes(q)) continue;
    const tr = el('tr');
    const thumb = el('td', '', 'thumb');
    if (p.thumb) {
      const img = el('img');
      img.loading = 'lazy'; img.alt = p.name || p.code;
      img.src = `/api/admin/thumb/${encodeURIComponent(p.code)}`;
      img.addEventListener('error', () => thumb.replaceChildren());
      const a = link('', `/?p=${encodeURIComponent(p.code)}`);
      a.append(img);
      thumb.append(a);
    }
    const who = el('td');
    who.append(el('div', p.name || '(no name)', 'name'), el('div', p.place, 'dim'), el('div', `${p.code}${p.size ? ` · ${p.size}` : ''}`, 'dim mono'));
    const route = el('td', [p.distance, p.gain && `${p.gain} gain`].filter(Boolean).join(' · ') || '—');
    const links = el('td');
    links.append(link('open', `/?p=${encodeURIComponent(p.code)}`), document.createTextNode(' · '), link('json', `/api/project/${encodeURIComponent(p.code)}`));
    const del = el('button', 'delete');
    del.type = 'button'; del.className = 'del'; del.title = `Delete ${p.code}`;
    del.addEventListener('click', () => void remove(p, tr));
    links.append(document.createTextNode(' · '), del);
    tr.append(thumb, who, route, el('td', when(p.savedAt)), el('td', String(p.points), 'n'), el('td', size(p.bytes), 'n'), links);
    rows.append(tr);
  }
}

async function main() {
  try {
    $('who').textContent = (await get<{ email: string }>('/api/admin/me')).email;
    const s = await get<{ projects: Project[]; totals: { projects: number; bytes: number } }>('/api/admin/summary');
    all = s.projects;
    refreshTotals();
    $('msg').hidden = all.length > 0;
    if (!all.length) $('msg').textContent = 'No saved projects yet.';
    $('table').hidden = !all.length;
    draw();
    $('find').addEventListener('input', draw);
  } catch (e) {
    $('msg').className = 'err';
    $('msg').textContent = `Could not load the admin data (${(e as Error).message}).`;
  }
}

if (typeof document !== 'undefined' && document.getElementById('rows')) void main();
