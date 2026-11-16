/** A place read from a photo's metadata: where it was taken, and when. The picture itself is never kept or sent. */
export interface PhotoPlace { name: string; lat: number; lon: number; takenAt?: string }

export type PhotoRead = { ok: true; place: PhotoPlace } | { ok: false; name: string; reason: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** "IMG_1234.JPG" -> "IMG_1234" */
export const nameFromFile = (file: string): string => file.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '').trim() || 'Photo';

/** The tags we ask the reader for (the reader works out latitude and longitude from the GPS ones). */
export const WANTED_TAGS = ['latitude', 'longitude', 'DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal'] as const;

/** A photo's tags as a place, or why it can't be one. `tags` is what the EXIF reader returned (undefined when the file has none). */
export function placeFromTags(fileName: string, tags: Record<string, unknown> | undefined): PhotoRead {
  const name = nameFromFile(fileName);
  if (!tags) return { ok: false, name, reason: 'no metadata in this file' };
  const lat = tags.latitude, lon = tags.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, name, reason: 'no location in this photo (it was taken with location off, or the location was removed when it was shared)' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, name, reason: 'the location is not valid' };
  if (lat === 0 && lon === 0) return { ok: false, name, reason: 'the location is empty' };
  const place: PhotoPlace = { name, lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  const when = tags.DateTimeOriginal ?? tags.CreateDate;
  // the camera writes its local clock time as "2024:07:04 10:32:05"; keep it as written, with no time zone
  const m = typeof when === 'string' ? /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(when) : null;
  if (m) place.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  else if (when instanceof Date && !Number.isNaN(when.getTime())) place.takenAt = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  return { ok: true, place };
}

/** Read the place from a photo's bytes (JPEG, HEIC, and others the reader knows). Nothing leaves the device. */
export async function readPhotoData(input: Blob | ArrayBuffer | Uint8Array, fileName: string): Promise<PhotoRead> {
  try {
    const { default: exifr } = await import('exifr');
    const tags = (await exifr.parse(input, { gps: true, exif: true, tiff: true, ifd1: false, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, pick: [...WANTED_TAGS], reviveValues: false })) as Record<string, unknown> | undefined;
    return placeFromTags(fileName, tags);
  } catch {
    return { ok: false, name: nameFromFile(fileName), reason: 'could not read this file as a photo' };
  }
}

/** Read the place from a photo the user chose. */
export const readPhoto = (file: File): Promise<PhotoRead> => readPhotoData(file, file.name);

/** A time as "Jul 4, 2024, 10:32" for the list of places found. */
export function showTaken(takenAt: string | undefined): string {
  if (!takenAt) return '';
  const d = new Date(takenAt.replace(/Z$|[+-]\d\d:?\d\d$/, '') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
