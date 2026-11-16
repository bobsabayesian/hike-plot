import { readPhoto, showTaken } from '../photo/exif';

const token = new URLSearchParams(location.search).get('s') ?? '';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $('out');
const err = $('err');
const input = $<HTMLInputElement>('file');

const line = (text: string, note: string, bad = false) => {
  const li = document.createElement('li');
  if (bad) li.className = 'bad';
  li.textContent = text;
  if (note) { const s = document.createElement('small'); s.textContent = note; li.append(s); }
  out.prepend(li);
};

if (!/^[2-9a-hjkmnp-z]{16}$/.test(token)) {
  err.hidden = false;
  err.textContent = 'This page needs the QR code from Walk of Frame. Scan it again.';
  $('pick').hidden = true;
}

input.addEventListener('change', async () => {
  const files = [...(input.files ?? [])];
  input.value = '';
  err.hidden = true;
  const places = [];
  for (const f of files) {
    const r = await readPhoto(f);
    if (r.ok) places.push(r.place);
    else line(r.name, r.reason, true);
  }
  if (!places.length) return;
  try {
    const res = await fetch(`/api/photo/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ places }) });
    if (res.status === 404) throw new Error('This session has expired. Scan a new QR code.');
    if (!res.ok) throw new Error('Could not send. Try again.');
    for (const p of places) line(`${p.name}: sent`, `${p.lat}, ${p.lon}${p.takenAt ? ' · ' + showTaken(p.takenAt) : ''}`);
  } catch (e) {
    err.hidden = false;
    err.textContent = e instanceof Error ? e.message : 'Could not send.';
  }
});
