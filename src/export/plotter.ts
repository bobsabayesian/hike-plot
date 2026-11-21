import type { Project } from '../scene/project';
import type { Scene } from '../scene/types';
import { applyCuts } from './cuts';
import { prepareScene, type FontSet, type PlotterText } from './outlines';
import type { SvgOptions } from './svg';

/** The poster as the plotter draws it: lines only, in each pen's width, then cut by the layer rules. Both the preview and the file use this. */
export function preparePlotter(scene: Scene, p: Project, fonts: FontSet, plotterText: PlotterText): Scene {
  return applyCuts(prepareScene(scene, 'plotter', fonts, { pens: p.pens, plotterText }), p.layers);
}

/** How the plotter file is laid out in layers: one per pen in the palette's order, or following the layer stack. */
export const plotterLayout = (p: Project): Pick<SvgOptions, 'layers' | 'pens' | 'stack'> => ({ layers: 'pen', pens: p.pens, stack: p.layers });
