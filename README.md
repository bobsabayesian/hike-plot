# Walk of Frame

Turn a hike (a GPX file) or any mountain you search for into a poster or a pen-plotter drawing: contour lines, your route,
landmarks, an elevation profile, and text, exported as SVG (one layer per pen color and width) or PNG.

## Run it

```bash
npm install
npm run dev        # the editor at http://localhost:5173, with the /api routes served locally
npm test           # unit tests
```

## Where the data comes from

- **Peaks, passes, viewpoints, shelters, rivers, lakes:** OpenStreetMap data served as vector tiles by [OpenFreeMap](https://openfreemap.org)
  (OpenMapTiles schema), read in the user's browser (`src/topo/vector.ts`). Tiles are static files, so this is fast and steady.
- **Trailheads (and huts and passes the tiles miss):** one small Overpass lookup through the Worker (`worker/api.ts`), because
  trailheads are not in the map tiles. If the tiles cannot be fetched at all, everything comes from Overpass instead.
- **Place search:** Nominatim, through the Worker. **Elevation:** Terrain Tiles on AWS.
- OpenFreeMap's terms do not allow automated data collection, so tiles are fetched only from the user's browser (never from
  the Worker), at most four at a time, and a view is limited to about 150 tiles (a wider view uses a lower zoom).
- `test/fixtures/tiles/` holds a few real tiles (OpenStreetMap contributors, ODbL) so the decoder is tested without a network.

## Deploy (from this computer, with wrangler)

The site is one Cloudflare Worker (`hike-plot`) that serves the built app and the `/api/*` routes. It is deployed with
wrangler from this machine, not from the Cloudflare dashboard.

```bash
npx wrangler login       # once; opens a browser to sign in. Check with: npx wrangler whoami
npm run deploy           # builds, then uploads the app and the Worker
```

`wrangler.toml` holds the Worker's name and its custom domain (`hike.bobsabayesian.io`), so every deploy keeps the domain
attached. Other commands:

```bash
npm run worker:dev                       # build, then run the real Worker locally at http://localhost:8787
npx wrangler deployments list            # what is live, and when it was deployed
npx wrangler tail                        # watch the live Worker's requests and errors
```

If you also have the repository connected under *Workers & Pages, hike-plot, Settings, Builds* in the Cloudflare
dashboard, disconnect it there so a dashboard build never replaces what you deployed from here.

After a deploy, `https://hike.bobsabayesian.io/api/health` shows which Overpass servers answer from Cloudflare.

### If the site will not open on a phone

The domain's DNS can be checked from any computer:

```bash
curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=hike.bobsabayesian.io&type=A'
```

A healthy answer lists two Cloudflare addresses (`104.21.x.x`, `172.67.x.x`). If that works but one phone cannot reach the
site, the cause is on the phone or its network: a DNS answer cached before the domain existed (switch Wi-Fi/cellular off
and on, or turn airplane mode on and off), a private DNS or VPN, iCloud Private Relay, or a content blocker. Try another
network, or open the address in a private tab.

## Pens and paper

Each pen has a kind (technical pen, fineliner such as Micron, gel, marker such as Molotow, or custom), a tip, and a spread: how far the ink bleeds past the tip on paper. The plotter export uses the width one pass leaves (tip plus spread on both sides) to decide how many passes a heavy line needs and how far apart hatch lines sit, so a Molotow fills solid without the lines merging. The kind's numbers are starting estimates; adjust the spread from your own swatches. Pens can be saved by name to a library kept in this browser (not in the project file) and put into any project. Pens without a kind (older projects) draw exactly as before.

The paper (color swatches from white to black, kraft, navy, and a custom picker) is chosen at the top of the "Pens and paper" panel and saved with the project. The panel also has a table of which pen draws each part of the poster, where any of them can be changed (each part's own group has the same choice); a pen whose ink is too close to the paper's color gets a warning there. The Design / Plotter switch above the poster shows it the way the pens will draw it: hatched fills, repeated passes, each line at its pen's ink width, translucent inks letting the paper show and darkening where lines overlap (on light paper; dark paper draws inks over it). It is slower, so it follows edits after a short pause, and click-to-edit is off while it is on. Exports never carry the transparency.

Contours can use a different pen for the heavy (index) lines: "Heavy pen" under Contours, or the "Major contour lines" row in the Pens table. The heavy lines and their elevation numbers then use that pen, drawn once with its own tip, and get their own layer in the plotter SVG. Left on "same pen", they are the contour pen drawn twice over, as before.

The route can have clear paper beside it: "Clear beside route" under Route cuts the contour and 3D relief lines that come within that many mm of the route's edge (half its weight, or its pen's line if wider). Off by default.

Saving over: the first save of a project also returns a secret key (only its hash is stored), which this browser keeps. For a project you saved yourself, "Save over" replaces the saved copy under the same code and link, and "Save as new" makes a new code. Anyone else who opens the code can only save as new, and projects saved before this existed can't be saved over. The key lives in this browser's storage, so clearing it, or another browser, means Save as new.

## Places from photos

At the bottom of Landmarks, "Add places from photos…" reads where a photo was taken from its own EXIF metadata (JPEG, HEIC and others) and adds it as a landmark. Choose files or drag them in, or press "Send from my phone" for a QR code: the phone opens `/phone`, reads the photos there, and sends only each place and time through the Worker. The photos are never uploaded. The relay keeps the places under `hike/photo/` for 15 minutes after the last post (expired ones are refused and deleted, and cleared when a new session starts). Phones often strip the location from photos shared through their photo pickers; the phone page says what to do.

Plotter text: under Export, "Text" chooses how text is written for a pen plotter. Single strokes draw each letter as a few lines of the pen (fast, and small labels stay readable); filled letters are outlined and hatched (heavier, but small ones clot with a wide pen); the default, Auto, uses single strokes for text up to 6 mm and filled letters for larger text such as the title. Text with a character the single-stroke set lacks (an accent, say) keeps the filled letters. The single-stroke shapes are the Hershey vector fonts (Dr. A. V. Hershey, U.S. National Bureau of Standards), "Sans 1-stroke" and "Serif medium", taken from the MIT-licensed `hersheytext` project (https://github.com/techninja/hersheytextjs); only the letter data is included, in `src/export/hersheyData.ts`.

Land cover can thin the contours under it: each inked kind has a "Clear lines" slider (0 to 100%). The terrain lines under that cover are broken into dashes, a bigger share of every 3 mm stretch left open the higher the slider, so the cover shows through while the shape of the ground still reads; 100% is the same as bare paper. It applies to contours (flat and 3D) and the in-between shade lines, and it means more pen lifts in the plotter file. The "Clear paper" pattern remains the all-the-way version.

## Layers: order and cuts (plotter view)

In the Plotter view on a desktop-width window, a Layers panel sits beside the poster (it is left out on narrow screens). Its rows are the parts of the design (Terrain lines, Land cover, Water, Route, Landmarks, text, ...), each showing its pen, in the order they are drawn: first at the top. Move a row with the arrows or by dragging it. Open a row to say which layers drawn before it it cuts lines out of, with a gap in mm that is added to half the width of its pen's line; a layer can only cut layers beneath it. "Top layers clear what is under them" draws the ground first and makes the route, north arrow, landmarks and text clear the terrain lines, land cover and water under them. Hovering a row dims the rest of the poster.

The cuts act on what the plotter actually draws (hatch, repeated passes, single strokes, marker width) in the plotter view and the plotter SVG, not in print, PNG or the Design view. The existing clearing settings (Clear beside route, Clear around labels, land cover Clear paper and Clear lines) keep working in their own panels and are shown as notes in the rows. With "Plot in this order" off (the default) the file keeps one layer per pen in the pens' order; on, the file's layers follow the order, one for each run of one pen, named after the pen and the parts in it, and the panel counts the pen changes. The settings are saved with the project.

## Zoom

On a desktop-width window the action bar has a zoom control (hidden on narrow screens, where pinching is native). The percentage is a share of the poster's real printed size (96 css px to the inch), so 100% is life size; click it to jump between Fit and 100%. Ctrl (or ⌘) and the mouse wheel, or a trackpad pinch, zoom toward the pointer; `+`, `-` and `0` do the same from the keyboard (not while a field has focus). Zoomed in, drag the poster to pan (in the Design view, not from a label, which drags itself) or use the scrollbars. The poster is vector, so it stays sharp; the most it shows is four times real size. The Layers panel stays where it is while the poster scrolls. Zoom is not saved with the project.

## Hand-drawn feel

The "Hand-drawn feel" group adds a steady, gentle wander to lines, as if drawn freehand: a Wobble amount (up to half a millimetre of drift over a few millimetres of line), Draw again (a new seed, same lines), and which layers wander (terrain, water, route, border, profile, north arrow, doodles by default; text stays as it is). It is applied when the poster is built, so the preview, PNG and both SVG kinds agree, and the layer cuts work on the wandering lines. Each line's wander depends on where it starts, so changing something else does not shift it. Tiny marks wander less, and closed shapes still close.

## Doodles

The "Doodles" group scatters little single-stroke drawings (pines, round trees, tents, mountains, flags, cairns, birds, clouds, a sun) over the map where there is room: not on the route, the landmark labels, the north arrow or each other, and inside the map. How many, how big, Shuffle (a new scatter from a new seed), the pens (one for the ground, one for the sky) and which kinds are on are settings. Trees come in groves and birds in flocks, at most one sun. Each doodle clears the terrain lines and land cover marks under it (a rounded box with the "Clear around" gap), the same way a landmark label does. In the 3D view the trees, tents, mountains, flags and cairns stand on terrain you can see, and the cloud, sun and birds go where there is no terrain (the sky above the relief); on a flat map everything goes on the map. Doodles are their own layer ("Doodles") in the layer sorter, and the hand-drawn wander applies to them by default.

## Handwritten title

Typography → Title → Lettering: "Printed" (the text font, with the filled / outline styles) or "Handwritten script" or "Handwritten script, fuller" (a double-line version). Handwriting is drawn as pen strokes in the title pen at its own line weight (0.6 mm to begin with, drawn as several passes if the pen is thinner), in the case you type rather than capitals, so it plots as single lines and is fast. It follows the title's size, alignment and justified width. A title with a character the script lacks (an accent, say) keeps the printed lettering. The letter shapes are the Hershey "Script 1-stroke" and "Script medium" faces, from the same data as the single-stroke plotter text.

## Saved projects and the admin page

"Save project" writes the whole poster (settings, GPX track and waypoints) as `hike/<code>.json` in the shared `project-files` R2 bucket, and returns an 8-character code. Opening a code, or a link with `?p=<code>`, restores it. Each save makes a new code, so one cannot overwrite another. The code is the only protection: anyone who has it can open the project.

`/admin` lists every saved project (picture, title, place, route numbers, paper size, when, track points, size, links to open it or its JSON) and can delete one (it asks first; this removes the file and its picture for good). It shows everyone's work, so it is protected twice, the same way as the Moire admin page:

1. **Cloudflare Access (Zero Trust)** in front of it. Add a *Self-hosted application* for `hike.bobsabayesian.io` with two destinations, the path `admin` and the path `api/admin/*`, and a policy that allows only you.
2. **The Worker checks the Access token itself** (`worker/access.ts`). Until `ACCESS_AUD` in `wrangler.toml` is filled in with the application's Audience (AUD) tag, `/admin` answers 503. Then `npm run deploy`.

Under `npm run dev` the page is at `/admin` with no sign-in and an empty list (saved projects live in R2).

## The 1-hour link

"Copy 1-hour link" next to the SVG download puts the SVG (as the Export settings make it, so a plotter SVG with a layer per pen) in `hike/share/<token>.svg` and copies `/api/share/<token>.svg`. The Worker enforces the hour itself (R2 only expires whole days, and only through a bucket rule): an older file is refused and deleted when asked for, and every new link clears the expired ones. The file is served with a sandboxing Content-Security-Policy, so it can only ever be data. The token (16 characters, about 80 bits) is the only key. To also have R2 clear any left-over files, add a lifecycle rule for the `hike/share/` prefix on the `project-files` bucket.

## Handwriting service

If you run a service that draws text as single-line SVG (`GET /api/v1/text.svg`, bearer token), set it up on the admin page (`/admin` → Handwriting service): the address and the project's token. They are stored in R2 and the token never reaches the browser; the Worker asks the service on the app's behalf (`/api/handwriter/text`, text up to 300 characters, margin 0). Once saved, Title → Lettering offers "My handwriting (service)", with the service's typeface, style preset and a seed ("another" for a new take). The strokes are fitted into the title width and plotted in the title pen at the line weight; until they arrive (or if the service is down) the printed lettering shows.

## Landmark icons and hatch angle

Landmark icons now include a tent, flag, camera, coffee cup and bear paw (pick one per kind or per landmark). Places added from photos are drawn with a camera. In the plotter view, "Hatch angle" (30° to 90°, 90° is upright) sets the direction of the hatch lines that fill shapes in the plotter file; the default is 45°.

## Water ripples

Under Landmarks, "Lake ripples" draws 1 to 4 rings that follow each lake's shore a little way in (the gap is adjustable), and "Wave marks on lakes" scatters small tilde marks over the open water. Both are drawn in the water pen, are off by default, and work in the 3D view too. Rings stop where a narrow neck or bay is too tight for them.

## Border styles

The border can be a single line, a double line, a postage-stamp edge (half-round notches bitten in), a twisted rope (two weaving strands) or a single rule with ornate corners (two quarter arcs and a small ring in each). "Gap between" becomes "Pattern size" for the new styles. They all sit inside the margin like the plain border, are pulled in to fit, and keep labels clear of their reach.

## QR code on the poster

The QR code group prints a code beside the text blocks, top or bottom, left, centre or right. It opens the project's saved link (the code shows as soon as the project is saved or opened by code; the link is not stored in the project) or any address you type. Each row of dark squares is one straight stroke as wide as a square, so a pen fills it solid and the plotter file needs no hatching. The group says how big each square comes out; below about 0.45 mm most pens cannot draw them cleanly.

## Sketchy double strokes

In the Hand-drawn feel group, "Sketchy" goes over every line of the ticked layers a second time, with its own wander and shifted a little to one side (up to 0.7 mm at 100%), like a drawing gone over twice. It works with or without the wobble, leaves fills and text alone, and doubles those lines in the plotter file too.
