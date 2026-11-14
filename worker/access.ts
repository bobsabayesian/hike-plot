/**
 * Checking that a request came through Cloudflare Access (Zero Trust). Access sits in front of the site and adds a signed token
 * (`Cf-Access-Jwt-Assertion`) to each request it lets through. The Worker checks that token itself as well, so that an Access
 * application that is missing, mistyped or switched off does not leave the admin pages open: nothing here trusts a request just
 * because it arrived.
 */

export interface AccessConfig {
  /** the Zero Trust team name ("acme"), or its full domain ("acme.cloudflareaccess.com") */
  team: string;
  /** the application's Audience (AUD) tag, from the Access application's settings */
  aud: string;
}

export interface AccessUser { email: string }

interface Jwk { kid: string; kty: string; alg?: string; n: string; e: string }
type Keys = (domain: string) => Promise<Jwk[]>;

const b64 = (s: string): Uint8Array<ArrayBuffer> => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const text = (s: string) => new TextDecoder().decode(b64(s));

/** "acme" and "acme.cloudflareaccess.com" both mean the same team. */
export const teamDomain = (team: string): string => { const t = team.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''); return t.endsWith('.cloudflareaccess.com') ? t : `${t}.cloudflareaccess.com`; };

let cached: { domain: string; at: number; keys: Jwk[] } | null = null;
const KEYS_TTL_MS = 10 * 60 * 1000;

/** The team's public signing keys, kept for ten minutes. */
export const fetchKeys: Keys = async (domain) => {
  if (cached && cached.domain === domain && Date.now() - cached.at < KEYS_TTL_MS) return cached.keys;
  const r = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`could not get the Access keys (${r.status})`);
  const keys = ((await r.json()) as { keys: Jwk[] }).keys;
  cached = { domain, at: Date.now(), keys };
  return keys;
};

/** The token a request carries, from the header Access adds or (failing that) the cookie it sets. */
export function tokenOf(req: Request): string | null {
  const h = req.headers.get('cf-access-jwt-assertion');
  if (h) return h;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get('cookie') ?? '');
  return m ? m[1]! : null;
}

/**
 * Who the request is from, if its Access token is genuine: signed by one of the team's keys, issued by the team, meant for
 * this application (the AUD tag), and not expired. Null for anything else.
 */
export async function verifyAccess(req: Request, cfg: AccessConfig, keys: Keys = fetchKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<AccessUser | null> {
  const token = tokenOf(req);
  const parts = token?.split('.');
  if (!parts || parts.length !== 3) return null;
  try {
    const header = JSON.parse(text(parts[0]!)) as { alg?: string; kid?: string };
    const claims = JSON.parse(text(parts[1]!)) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; sub?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const domain = teamDomain(cfg.team);
    if (claims.iss !== `https://${domain}`) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!aud.includes(cfg.aud)) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 30) return null;
    const jwk = (await keys(domain)).find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? { email: claims.email ?? claims.sub ?? 'unknown' } : null;
  } catch { return null; }
}
