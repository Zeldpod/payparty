# PayParty — Desktop App (Electron)

Cross-platform (macOS · Windows · Linux) desktop app:
- **Main window:** glassy login → dashboard (balance, launch widget, cash out)
- **Widget:** frameless, transparent, always-on-top **glass card** that shows a sponsored ad and earns while your screen is on. It loads the hosted PayParty widget page (`https://www.payparty.fun/widget`), which integrates **Adsterra** and credits real money server-side via `/api/earn`.

## Run it (dev)
```bash
cd desktop
npm install
npm start
```

## Build installers
```bash
npm run dist:mac     # .dmg + .zip
npm run dist:win     # .exe (NSIS)
npm run dist:linux   # .AppImage + .deb
```
Output lands in `desktop/release/`.

## The widget page (`https://www.payparty.fun/widget`)
By default the widget window loads the **live** hosted page at
`https://www.payparty.fun/widget?host=app&token=<access_token>`. The token is the
signed-in user's Supabase access token; the page POSTs `/api/earn` with it and
credits real money. A `will-navigate` guard keeps the window pinned to
`/widget`; anything else opens in the user's browser.

- Offline dev (bundled house-ad page, no real earnings):
  ```bash
  PP_WIDGET_URL=local npm start
  # or any URL:
  PP_WIDGET_URL=https://staging.payparty.fun/widget npm start
  ```

## Ads & earnings (Adsterra, server-side)
The desktop app does **not** configure ads itself — it just loads the hosted
widget page (`https://www.payparty.fun/widget`), which is the single source of
truth for both the ad creatives and the money:

- **Ads:** the hosted widget renders **Adsterra** units from `payparty.fun`
  (the verified domain) — a 300×250 banner by default, plus a native unit and
  Social Bar at the larger tier. Edit them in `../widget/` + `../widget/ad-*.html`,
  not here.
- **Earnings:** the widget POSTs `/api/earn` with the signed-in user's token and
  the balance is credited **server-side** (`credit_earnings`, service-role). The
  desktop app never mints balance.
- **House ad:** if a real ad doesn't fill, the widget shows a built-in branded
  placeholder card so the slot is never blank.

> `windows/widget.*` is a legacy **offline house-ad** page used **only** with
> `PP_WIDGET_URL=local`; it does not earn and is not the production path.

## Real services (no more mocks)
- **Auth** (`main.js` → `auth:login` / `auth:signup`): real Supabase email/password
  via direct REST (no SDK). Sessions are stored and auto-refreshed before expiry.
  Google opens `https://www.payparty.fun/login` in the browser as a fallback.
- **Earnings:** credited **server-side** by the hosted widget via `/api/earn`
  (the desktop app no longer mints any balance). The dashboard balance is a
  read-only mirror fetched from the Supabase `profiles` table.
- **Cash out** (`main.js` → `cashout:request`): real authenticated
  `request_cashout` RPC (enforces the $5 minimum, debits atomically). With no
  destination entered it opens the web dashboard instead — it never zeroes the
  local balance.

State is persisted via `electron-store` (`session`, plus a `balance`/`lifetime` mirror).

## Architecture
```
main.js        Electron main: windows, IPC, Supabase auth/profile/cashout, persistence
preload.js     contextBridge → window.payparty (secure API, main window only)
windows/app.*  Main window (login + dashboard)
windows/widget.* Bundled offline glass-card widget (used only for PP_WIDGET_URL=local)
```

## Dev self-test screenshots
```bash
PP_SHOT=login     npm start   # writes shot-login.png then quits
PP_SHOT=dashboard npm start   # writes shot-dashboard.png
PP_SHOT=widget    npm start   # writes shot-widget.png
```
