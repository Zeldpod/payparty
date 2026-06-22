# PayParty

Get paid to do whatever. A tiny sponsored widget that pays you while your screen is on.

## Structure
| Path | What |
|------|------|
| `index.html` · `login.html` · `dashboard.html` | Marketing site, Supabase auth, account dashboard, and cash-out requests (deployed to **payparty.fun** via Vercel) |
| `dashboard.css` · `dashboard.js` | Dashboard presentation, account activity, and payout-request UI |
| `widget/index.html` | The earning widget served at **payparty.fun/widget** — real Adsterra ads run here (the verified domain). The desktop app and extension load this page; ad code lives ONLY here, never on the marketing pages. |
| `supabase-config.js` | Public client config (anon key only — safe) |
| `supabase/schema.sql` | Run once in the Supabase SQL editor |
| `assets/` | Silk background, app icon, product art |
| `desktop/` | Electron desktop app (Mac · Windows · Linux) |
| `extension/` | Chrome (MV3) browser extension |

## Web (Vercel)
Static site — no build step. Vercel auto-detects. Domain: `payparty.fun`.

## Supabase / cash-outs

Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor after every schema change. The schema:

- removes direct client balance updates;
- records verified earnings in an immutable ledger;
- reserves cash-out funds atomically with a replay-safe request key;
- exposes payout status/history to the owning user only; and
- refunds failed or cancelled requests exactly once.

`request_cashout` is available to authenticated clients. `credit_earnings` and
`resolve_cashout` are service-role-only and must be called by a trusted server,
verified ad postback, or payout worker. A cash-out request queues and reserves
funds; actual PayPal/Venmo/Cash App delivery still requires that private worker
and the relevant provider credentials.

For a local visual preview without an account, serve the repository and open
`/dashboard.html?preview=1` on `localhost`. Preview mode cannot run on the live
domain.

## Secrets
The `anon` key is public and lives in `supabase-config.js`. The **`service_role` / `sb_secret_*` keys are NEVER committed** — they belong in Vercel/server **environment variables** only.

## Run the desktop app
```bash
cd desktop && npm install && npm start
```

## Load the extension
`chrome://extensions` → Developer mode → Load unpacked → select `extension/`.
