# Roadmap: whimsy and personality

The plan is to add the ingredients first, see which ones feel right, and then make mood presets ("Treasure map", "Field journal", "Blueprint"...) from the ones that earn their place. Every decoration should be its own layer, so the layer sorter can cut lines out from under it, and everything has to survive a pen plotter: single strokes, no fills, few pen lifts.

Status: **building** (being added now), **next**, **later**, **done**.

## Hand-made feel
- **Hand-drawn wobble**: a slider that adds seeded, subtle wander to lines, per layer, with a Shuffle button for a new seed. *done (not yet deployed)*
- **Sketchy double strokes**: a second pass offset a little, using the pass machinery the plotter export already has. *later*
- **Handwriting title**: choose the Hershey script/cursive faces (the data is already in the repo) for the title. *next*
- **Title flourishes**: title on an arc, a bouncing baseline, an offset shadow pass, a ribbon or banner behind it. *later*

## Things to look at in the empty space
- **Doodles**: single-stroke pines, trees, tents, mountains, flags, cairns, birds, clouds and a sun, placed where they do not collide with the route or labels, clearing the lines under them; in the 3D view the sky gets the sun, clouds and birds. *done (not yet deployed)*
- **Richer landmark icons**: tent, flag, camera, coffee cup, bear paw; photo-sourced landmarks default to a camera. *next*
- **Callouts**: a speech bubble or leader line on a landmark with your own note ("lunch here, best view"). *later*

## Cartographic charm
- **Water ripples**: concentric ripple lines along lake shores and wave marks on water. *next*
- **Border styles**: postage-stamp perforations, rope, double rule, ornate corners. *next*
- **Old-fashioned peaks**: molehill-profile mountain symbols instead of triangles. *later*

## Playful text
- **Fun stats**: "≈ 2.8 Eiffel Towers of climbing", steps, football fields, bananas end to end, Everests. *done (not yet deployed)*
- **Stamp badge**: a circular passport stamp with place and date, or a "summit achieved" ribbon. *later*

## Colour and personality
- **Elevation-banded contour pens**: low ground in one pen, high in another, one pen per band; a rainbow-by-mile route the same way. *later*
- **Mood presets**: Treasure map, Blueprint, Field journal, Vintage park poster, Minimal; a dice button that picks a random palette within sensible limits. *after the ingredients above*
- **QR code**: a QR to the saved project link in a corner, drawn as plotter-friendly squares (the QR library is already a dependency). *next*

## Older leftovers
- Per-landmark label size.
- A rate limit for public saves and the phone relay.
- An R2 lifecycle rule for `hike/share/` and `hike/photo/`.
