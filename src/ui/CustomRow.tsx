import { useEffect, useState } from 'react';
import { parseLatLon, type CustomLandmark } from '../features/custom';

const show = (c: CustomLandmark) => (c.lat !== undefined && c.lon !== undefined ? `${c.lat}, ${c.lon}` : '');

/** One landmark added by hand: its name, where it goes, and (for lat/lon) the coordinates. */
export function CustomRow({ c, hasTrack, onChange, onRemove }: {
  c: CustomLandmark; hasTrack: boolean; onChange: (patch: Partial<CustomLandmark>) => void; onRemove: () => void;
}) {
  const [text, setText] = useState(show(c));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(show(c)); setBad(false); }, [c.lat, c.lon, c.at]);
  return (
    <div className="lm custom-row">
      <button type="button" className="x" title="Remove" aria-label={`Remove ${c.name}`} onClick={onRemove}>×</button>
      <input type="text" aria-label="Name" value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
      <select aria-label="Where" value={c.at} onChange={(e) => onChange({ at: e.target.value as CustomLandmark['at'] })}>
        <option value="start" disabled={!hasTrack}>Start of GPX</option>
        <option value="end" disabled={!hasTrack}>End of GPX</option>
        <option value="high" disabled={!hasTrack}>High point of GPX</option>
        <option value="latlon">Lat / lon</option>
      </select>
      {c.at === 'latlon' && (
        <input type="text" className={bad ? 'bad' : ''} aria-label="Latitude, longitude" placeholder="46.8523, -121.7603" value={text} style={{ gridColumn: '2 / 5' }}
          onChange={(e) => { setText(e.target.value); const v = parseLatLon(e.target.value); setBad(!v); if (v) onChange(v); }} />
      )}
      {c.at !== 'latlon' && !hasTrack && <span className="hint" style={{ gridColumn: '2 / 5' }}>Needs a GPX track.</span>}
    </div>
  );
}
