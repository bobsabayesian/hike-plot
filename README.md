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

## Saved projects and the admin page

"Save project" writes the whole poster (settings, GPX track and waypoints) as `hike/<code>.json` in the shared `project-files` R2 bucket, and returns an 8-character code. Opening a code, or a link with `?p=<code>`, restores it. Each save makes a new code, so one cannot overwrite another. The code is the only protection: anyone who has it can open the project.

`/admin` lists every saved project (picture, title, place, route numbers, paper size, when, track points, size, links to open it or its JSON) and can delete one (it asks first; this removes the file and its picture for good). It shows everyone's work, so it is protected twice, the same way as the Moire admin page:

1. **Cloudflare Access (Zero Trust)** in front of it. Add a *Self-hosted application* for `hike.bobsabayesian.io` with two destinations, the path `admin` and the path `api/admin/*`, and a policy that allows only you.
2. **The Worker checks the Access token itself** (`worker/access.ts`). Until `ACCESS_AUD` in `wrangler.toml` is filled in with the application's Audience (AUD) tag, `/admin` answers 503. Then `npm run deploy`.

Under `npm run dev` the page is at `/admin` with no sign-in and an empty list (saved projects live in R2).

## The 1-hour link

"Copy 1-hour link" next to the SVG download puts the SVG (as the Export settings make it, so a plotter SVG with a layer per pen) in `hike/share/<token>.svg` and copies `/api/share/<token>.svg`. The Worker enforces the hour itself (R2 only expires whole days, and only through a bucket rule): an older file is refused and deleted when asked for, and every new link clears the expired ones. The file is served with a sandboxing Content-Security-Policy, so it can only ever be data. The token (16 characters, about 80 bits) is the only key. To also have R2 clear any left-over files, add a lifecycle rule for the `hike/share/` prefix on the `project-files` bucket.
