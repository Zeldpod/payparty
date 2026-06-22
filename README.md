# PayParty

Get paid to do whatever. A tiny sponsored widget that pays you while your screen is on.

## Structure
| Path | What |
|------|------|
| `index.html` · `login.html` · `dashboard.html` | Marketing site + Supabase auth (deployed to **payparty.fun** via Vercel) |
| `supabase-config.js` | Public client config (anon key only — safe) |
| `supabase/schema.sql` | Run once in the Supabase SQL editor |
| `assets/` | Silk background, app icon, product art |
| `desktop/` | Electron desktop app (Mac · Windows · Linux) |
| `extension/` | Chrome (MV3) browser extension |

## Web (Vercel)
Static site — no build step. Vercel auto-detects. Domain: `payparty.fun`.

## Secrets
The `anon` key is public and lives in `supabase-config.js`. The **`service_role` / `sb_secret_*` keys are NEVER committed** — they belong in Vercel/server **environment variables** only.

## Run the desktop app
```bash
cd desktop && npm install && npm start
```

## Load the extension
`chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
