# PayParty — Desktop App (Electron)

Cross-platform (macOS · Windows · Linux) desktop app:
- **Main window:** glassy login → dashboard (balance, launch widget, cash out)
- **Widget:** frameless, transparent, always-on-top **glass card** that shows a sponsored ad and earns while your screen is on. It loads the PayParty widget page, which integrates **AdMaven**.

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

## The widget page (`payparty.app/widget`)
By default the widget window loads the **bundled** `windows/widget.html` so the app runs with no backend. The same file is what you deploy to `https://payparty.app/widget`.

- Use the live page once deployed:
  ```bash
  PP_WIDGET_URL=remote npm start
  # or any URL:
  PP_WIDGET_URL=https://staging.payparty.app/widget npm start
  ```

## Wire up AdMaven (3 formats)
Open `windows/widget.js` and fill the `ADMAVEN` config:

```js
const ADMAVEN = {
  inpagePushSrc: '',   // In-Page Push / Floating Banner zone script src
  inpagePushTag: '',   // OR paste the raw <script> snippet AdMaven gives you
  interstitialSrc: '', // Interstitial zone script src (fired on "Fullscreen offer")
  smartlink: ''        // Direct Link / Smartlink URL — 100% fill, used by "View sponsor"
};
```

- **In-Page Push / Floating Banner** → best match for the widget. Set `inpagePushSrc` (or paste `inpagePushTag`). When set, the network creative replaces the house ad.
- **Interstitial** → set `interstitialSrc`; it fires when the user clicks **Fullscreen offer** (intent-based, so it's not annoying).
- **Direct Link / Smartlink** → set `smartlink`; the **View sponsor** button opens it and credits earnings. This is the easiest fallback (100% fill).

With nothing configured, the widget shows a branded **house ad** (AirPods Pro 3) so it always looks good.

## What's mocked (swap for real services)
- **Auth** (`main.js` → `auth:login`): currently stores a local user. Replace with your OAuth / backend.
- **Earnings** (`main.js` → `startEarnLoop`, `earn:add`): simulates +$0.01 / 5s while the widget is open, +$0.05 per sponsor click. Replace with **server-confirmed AdMaven postbacks**.
- **Cash out** (`main.js` → `cashout:request`): stub. Wire to PayPal / Venmo / Cash App payouts.

State is persisted via `electron-store` (`user`, `balance`, `lifetime`).

## Architecture
```
main.js        Electron main: windows, IPC, earnings engine, persistence
preload.js     contextBridge → window.payparty (secure API, both windows)
windows/app.*  Main window (login + dashboard)
windows/widget.* Floating glass-card widget + AdMaven integration
```

## Dev self-test screenshots
```bash
PP_SHOT=login     npm start   # writes shot-login.png then quits
PP_SHOT=dashboard npm start   # writes shot-dashboard.png
PP_SHOT=widget    npm start   # writes shot-widget.png
```
