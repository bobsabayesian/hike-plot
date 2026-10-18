# Walk of Frame

Turn a hike (a GPX file) or any mountain you search for into a poster or a pen-plotter drawing: contour lines, your route,
landmarks, an elevation profile, and text, exported as SVG (one layer per pen color and width) or PNG.

## Run it

```bash
npm install
npm run dev        # the editor at http://localhost:5173, with the /api routes served locally
npm test           # unit tests
```

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
