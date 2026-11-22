import { sceneToSvg } from './svg';
import type { Scene } from '../scene/types';
import { loadFonts } from './fonts';
import { prepareScene } from './outlines';

/** Conservative limits that every mainstream browser canvas accepts. */
export const MAX_SIDE_PX = 12000;
export const MAX_AREA_PX = 100_000_000;

export interface PngSize { width: number; height: number; dpi: number; capped: boolean }

/** Pixel size for a poster at `dpi`, scaled down if the browser couldn't make a canvas that large. */
export function pngSize(widthMm: number, heightMm: number, dpi: number): PngSize {
  const w = (widthMm / 25.4) * dpi;
  const h = (heightMm / 25.4) * dpi;
  const k = Math.min(1, MAX_SIDE_PX / Math.max(w, h), Math.sqrt(MAX_AREA_PX / (w * h)));
  return { width: Math.round(w * k), height: Math.round(h * k), dpi: Math.round(dpi * k), capped: k < 1 };
}

export interface ProofMark { x: number; y: number }

/** Where the proof words go: rows of them at 30° across the whole picture, every other row shifted half a step. */
export function proofMarks(width: number, height: number, fontPx: number, textPx: number): { marks: ProofMark[]; angle: number } {
  const angle = -Math.PI / 6;
  const stepX = textPx + fontPx * 3;
  const stepY = fontPx * 5;
  // walk the rotated grid far enough to cover the corners
  const reach = Math.hypot(width, height);
  const marks: ProofMark[] = [];
  for (let r = -Math.ceil(reach / stepY); r <= Math.ceil(reach / stepY); r++) {
    for (let c = -Math.ceil(reach / stepX); c <= Math.ceil(reach / stepX); c++) {
      const u = (c + (r % 2 ? 0.5 : 0)) * stepX;
      const v = r * stepY;
      const x = width / 2 + u * Math.cos(angle) - v * Math.sin(angle);
      const y = height / 2 + u * Math.sin(angle) + v * Math.cos(angle);
      if (x > -textPx && x < width + textPx && y > -fontPx && y < height + fontPx) marks.push({ x, y });
    }
  }
  return { marks, angle };
}

/** Rasterize the scene (paper color included) to a PNG blob. `proof` is stamped across it in pale grey, so a preview can't pass for the print. */
export async function sceneToPng(scene: Scene, dpi: number, proof = ''): Promise<{ blob: Blob; size: PngSize }> {
  const size = pngSize(scene.widthMm, scene.heightMm, dpi);
  // The image renderer can't see page fonts, so text is always outlined for PNG.
  const svg = sceneToSvg(prepareScene(scene, 'print', await loadFonts()), { paper: true }).replace(
    /width="[\d.]+mm" height="[\d.]+mm"/,
    `width="${size.width}" height="${size.height}"`,
  );
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const word = proof.trim();
    if (word) {
      const fontPx = Math.max(12, Math.min(size.width, size.height) / 14);
      ctx.font = `700 ${fontPx}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const { marks, angle } = proofMarks(size.width, size.height, fontPx, ctx.measureText(word).width);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#d00000';
      for (const m of marks) {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(angle);
        ctx.fillText(word, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'),
    );
    return { blob, size };
  } finally {
    URL.revokeObjectURL(url);
  }
}
