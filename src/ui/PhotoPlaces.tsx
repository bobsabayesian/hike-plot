import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { readPhoto, showTaken, type PhotoPlace } from '../photo/exif';
import { collectPlaces, endPhotoSession, phoneUrl, startPhotoSession } from '../photo/session';

/** The QR code for an address, as inline SVG. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

type Note = { text: string; bad?: boolean };

/**
 * Add landmarks from photos: the place each was taken is read from the photo's own metadata. Choose or drag photos here, or
 * show a QR code and send them from a phone. Only the place (and time) is read; a photo is never uploaded or kept.
 */
export function PhotoPlaces({ onPlaces }: { onPlaces: (places: PhotoPlace[]) => void }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [session, setSession] = useState<{ token: string; expiresAt: number } | null>(null);
  const [phoneErr, setPhoneErr] = useState('');
  const seen = useRef(0);
  const add = useRef(onPlaces);
  add.current = onPlaces;

  const take = (places: PhotoPlace[]) => {
    if (!places.length) return;
    add.current(places);
    setNotes((n) => [...places.map((p) => ({ text: `Added ${p.name}: ${p.lat}, ${p.lon}${p.takenAt ? ` · ${showTaken(p.takenAt)}` : ''}` })), ...n].slice(0, 12));
  };

  async function fromFiles(files: File[]) {
    const found: PhotoPlace[] = [];
    for (const f of files) {
      const r = await readPhoto(f);
      if (r.ok) found.push(r.place);
      else setNotes((n) => [{ text: `${r.name}: ${r.reason}`, bad: true }, ...n].slice(0, 12));
    }
    take(found);
  }

  // while a phone session is showing, ask for what the phone has sent every couple of seconds
  useEffect(() => {
    if (!session) return;
    let live = true;
    seen.current = 0;
    const tick = async () => {
      try {
        const { places, expired } = await collectPlaces(session.token);
        if (!live) return;
        if (expired) { setPhoneErr('This phone session has expired. Start a new one.'); setSession(null); return; }
        if (places.length > seen.current) { take(places.slice(seen.current)); seen.current = places.length; }
      } catch { /* try again on the next tick */ }
    };
    const t = setInterval(tick, 2000);
    const stop = setTimeout(() => { if (live) { setPhoneErr('This phone session has expired. Start a new one.'); setSession(null); } }, Math.max(0, session.expiresAt - Date.now()));
    return () => { live = false; clearInterval(t); clearTimeout(stop); };
  }, [session]);

  const closeSession = () => { if (session) void endPhotoSession(session.token); setSession(null); };
  useEffect(() => () => { if (session) void endPhotoSession(session.token); }, [session]);

  async function startPhone() {
    setPhoneErr('');
    try { setSession(await startPhotoSession()); } catch (e) { setPhoneErr(e instanceof Error ? e.message : 'Could not start'); }
  }

  if (!open) return <div className="row"><button type="button" className="link" onClick={() => setOpen(true)}>Add places from photos…</button></div>;
  const url = session ? phoneUrl(session.token) : '';
  return (
    <div className="field photoplaces">
      <div className="row"><strong>Places from photos</strong><button type="button" className="link" onClick={() => { closeSession(); setOpen(false); }}>close</button></div>
      <div className="hint">Reads where a photo was taken from its own metadata and adds it as a landmark. The photo itself never leaves your device.</div>
      <label className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void fromFiles([...e.dataTransfer.files]); }}>
        Drop photos here, or choose…
        <input type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { void fromFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>
      {!session && <div className="row"><button type="button" onClick={() => void startPhone()}>Send from my phone (QR code)</button></div>}
      {phoneErr && <div className="err">{phoneErr}</div>}
      {session && (
        <div className="qr">
          <div className="qrimg" role="img" aria-label="QR code to open the photo page on your phone" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
          <div className="hint">Scan with your phone's camera, then choose photos there. Only each photo's location and time are sent, through this site, and kept for up to 15 minutes. Waiting for photos…</div>
          <div className="hint mono">{url}</div>
          <div className="row"><button type="button" onClick={closeSession}>Stop</button></div>
        </div>
      )}
      {notes.length > 0 && <ul className="notes">{notes.map((n, i) => <li key={i} className={n.bad ? 'err' : ''}>{n.text}</li>)}</ul>}
    </div>
  );
}
