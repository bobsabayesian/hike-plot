/** Renderer-agnostic drawing description. Preview, SVG, PDF and PNG all consume this. */
export interface PathPrim {
  kind: 'path';
  /** SVG path data in poster mm */
  d: string;
  color: string;
  mode: 'stroke' | 'fill';
  widthMm?: number;
  dash?: number[];
  round?: boolean;
  opacity?: number;
}

export interface TextPrim {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  sizeMm: number;
  /** extra letter spacing, mm */
  trackingMm: number;
  fontFamily: string;
  fontKey: 'sans' | 'serif';
  /** degrees clockwise about (x, y); undefined = horizontal */
  rotate?: number;
  color: string;
  opacity?: number;
}

export type Prim = PathPrim | TextPrim;

export interface Scene {
  widthMm: number;
  heightMm: number;
  paper: string;
  /** painter's order: first drawn first */
  prims: Prim[];
}
