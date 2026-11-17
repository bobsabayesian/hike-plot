/** Renderer-agnostic drawing description. Preview, SVG, PDF and PNG all consume this. */
/** How densely a fill is hatched for a plotter, relative to the pen tip. */
export type HatchDensity = 'solid' | 'medium' | 'light';

/** Which part of the poster a primitive draws; the editor preview uses it to open that part's settings when clicked. */
export type Part = 'border' | 'title' | 'location' | 'info' | 'watermark' | 'contours' | 'relief' | 'cover' | 'water' | 'profile' | 'route' | 'north' | 'landmarks';

export interface PathPrim {
  kind: 'path';
  part?: Part;
  /** SVG path data in poster mm */
  d: string;
  color: string;
  mode: 'stroke' | 'fill';
  widthMm?: number;
  dash?: number[];
  round?: boolean;
  opacity?: number;
  /** id of the pen this is drawn with (sets the tip width in the plotter export) */
  pen?: string;
  /** plotter export: a fill is drawn as hatch lines of this density instead of just its outline */
  hatch?: HatchDensity;
  /** plotter export: draw at least this many passes of the pen, even if the line is thinner than that implies */
  minPasses?: number;
}

export interface TextPrim {
  kind: 'text';
  part?: Part;
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
  /** id of the pen this is written with */
  pen?: string;
  /** landmark this text labels; lets the preview open it for editing when clicked */
  ref?: string;
  /** 'stroke' draws only the outline of the letters, `strokeMm` wide; the default is a filled letter */
  mode?: 'fill' | 'stroke';
  strokeMm?: number;
  /** stretch the text to exactly this width by changing its letter spacing (justified text); anchor must be 'start' */
  fitWidthMm?: number;
  /** plotter export: hatch the letters in this density rather than outlining them */
  hatch?: HatchDensity;
  /** plotter export: how densely plain filled letters are filled in (they are outlined too); default solid */
  plotFill?: HatchDensity;
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
