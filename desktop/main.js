'use strict';
/* ============================================================
   PayParty — Electron main process
   - Main window: login → dashboard (glassy)
   - Widget window: frameless, transparent, always-on-top glass
     card that loads the PayParty widget page (with AdMaven ads)
   ============================================================ */
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');

const store = new Store({
  // `session` holds the real Supabase session (access/refresh tokens + user).
  // balance/lifetime are a read-only mirror of the server profile — never the
  // source of truth and never minted locally.
  defaults: { session: null, balance: 0, lifetime: 0 }
});

/* ------------------------------------------------------------
   SUPABASE (direct REST — no SDK in the desktop app)
   The anon key is public/safe to ship. The service_role key
   NEVER lives here; money is credited server-side via /api/earn.
   ------------------------------------------------------------ */
const SUPABASE_URL = 'https://fcpetkipzuzbuzidvsjz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcGV0a2lwenV6YnV6aWR2c2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjMyMzksImV4cCI6MjA5NjQ5OTIzOX0.3BhIEcJwkjCLCZ1HgMDzXaGrmLdWcKUU54RE0wwSOvo';
const SITE_URL = 'https://www.payparty.fun';

/* ------------------------------------------------------------
   WIDGET PAGE URL
   In production this loads your hosted page (which contains the
   AdMaven integration). For local dev it falls back to the
   bundled widget.html so the app runs without deploying first.
   ------------------------------------------------------------ */
const REMOTE_WIDGET_ORIGIN = SITE_URL + '/widget';
const LOCAL_WIDGET_URL = 'file://' + path.join(__dirname, 'windows', 'widget.html');
// Loads the live hosted widget (real ads on the verified domain) by default.
// The widget credits money server-side via /api/earn using the access token we
// pass in the URL (?token=…). The will-navigate guard keeps it pinned there.
// PP_WIDGET_URL=local  → bundled house-ad widget (offline dev, no real earnings)
// PP_WIDGET_URL=<url>  → a custom page
function widgetUrl() {
  if (process.env.PP_WIDGET_URL === 'local') return LOCAL_WIDGET_URL;
  if (process.env.PP_WIDGET_URL && process.env.PP_WIDGET_URL !== 'remote') return process.env.PP_WIDGET_URL;
  const token = accessToken();
  const q = new URLSearchParams({ host: 'app' });
  if (token) q.set('token', token);
  return REMOTE_WIDGET_ORIGIN + '?' + q.toString();
}

const isMac = process.platform === 'darwin';
const preload = path.join(__dirname, 'preload.js');

let mainWindow = null;
let widgetWindow = null;
let refreshTimer = null;

/* ---- ad tiers: bigger widget → richer ad format ----
   The widget reads its own size and reports the tier; the rate (for the live
   "$/min" hint) mirrors the server-side RATE table in /api/earn. The desktop
   app does NOT mint money — credit_earnings runs server-side from /api/earn. */
const AD_RATES = { compact: 0.02, standard: 0.05, large: 0.15 };
let currentTier = 'standard';

/* ---------- session helpers (real Supabase auth) ---------- */
function getSession() { return store.get('session', null); }
function accessToken() { const s = getSession(); return s && s.access_token ? s.access_token : null; }
function sessionUser() {
  const s = getSession();
  if (!s || !s.user) return null;
  return { email: s.user.email || '', id: s.user.id || '', provider: 'email' };
}

/* ---------- shared state ---------- */
function getState() {
  return {
    user: sessionUser(),
    balance: Math.round(store.get('balance', 0) * 100) / 100,
    lifetime: Math.round(store.get('lifetime', 0) * 100) / 100,
    widgetOpen: !!(widgetWindow && !widgetWindow.isDestroyed()),
    tier: currentTier,
    rate: AD_RATES[currentTier] || 0,
    platform: process.platform
  };
}
function broadcast() {
  const s = getState();
  [mainWindow, widgetWindow].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('state:update', s);
  });
}

/* ---------- Supabase REST: auth + profile (no SDK) ---------- */
async function supaAuth(pathAndQuery, body) {
  const res = await fetch(SUPABASE_URL + pathAndQuery, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const msg = (data && (data.error_description || data.msg || data.error || data.message)) || ('Request failed (' + res.status + ')');
    throw new Error(msg);
  }
  return data;
}

// Persist a Supabase token response and schedule a refresh before it expires.
function storeSession(tok) {
  if (!tok || !tok.access_token) return;
  const session = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (Number(tok.expires_in || 3600) * 1000),
    user: tok.user || (getSession() && getSession().user) || null
  };
  store.set('session', session);
  scheduleRefresh(session);
}
function clearSession() {
  store.set('session', null);
  store.set('balance', 0);
  store.set('lifetime', 0);
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}
function scheduleRefresh(session) {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (!session || !session.refresh_token) return;
  // refresh ~60s before expiry, clamped to a sane window
  const lead = 60 * 1000;
  const delay = Math.max(5 * 1000, Math.min((session.expires_at - Date.now()) - lead, 0x7fffffff));
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, delay);
}
async function refreshSession() {
  const s = getSession();
  if (!s || !s.refresh_token) return null;
  try {
    const tok = await supaAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    storeSession(tok);
    // a refreshed token means the widget's ?token= is stale → reload it
    if (widgetWindow && !widgetWindow.isDestroyed() && !process.env.PP_WIDGET_URL) {
      widgetWindow.loadURL(widgetUrl());
    }
    return tok;
  } catch (e) {
    // refresh token rejected → force re-login
    clearSession();
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
    broadcast();
    return null;
  }
}

// Fetch the real balance/lifetime from the profiles table via PostgREST.
async function fetchProfile() {
  const token = accessToken();
  const user = getSession() && getSession().user;
  if (!token || !user || !user.id) return;
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=balance,lifetime',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } }
    );
    if (!res.ok) return;
    const rows = await res.json();
    const p = Array.isArray(rows) && rows[0];
    if (p) {
      store.set('balance', Number(p.balance) || 0);
      store.set('lifetime', Number(p.lifetime) || 0);
      broadcast();
    }
  } catch (e) { /* offline / transient — keep last known mirror */ }
}

/* ---------- main window ---------- */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 860,
    minHeight: 580,
    backgroundColor: '#f4f1fb',
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'windows', 'app.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ---------- floating widget window ---------- */
function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 360, H = 480;
  widgetWindow = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 300,   // can't shrink it into nothing (anti-cheat: ad must stay visible)
    minHeight: 150,  // compact tier (320x50 banner) still fits
    maxWidth: 640,
    maxHeight: 720,
    x: wa.x + wa.width - W - 24,
    y: wa.y + wa.height - H - 24,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    // NOTE: no preload here on purpose — the widget loads a remote page that
    // runs third-party ad scripts, so it must NOT get the privileged IPC bridge.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
  if (typeof widgetWindow.setVisibleOnAllWorkspaces === 'function') {
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  // Loads https://www.payparty.fun/widget?host=app&token=<access_token>.
  // The widget itself POSTs /api/earn with the token and credits real money.
  widgetWindow.loadURL(widgetUrl());
  // sponsor links (and any ad pop) open in the user's real browser, never as a
  // new app window
  widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Navigation guard: the widget is allowed to stay on /widget (and our own
  // bundled file:// page in offline dev). Anything an ad script tries to
  // navigate the top frame to opens in the real browser instead.
  widgetWindow.webContents.on('will-navigate', (e, url) => {
    if (isAllowedWidgetUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  // keep the widget fully on screen — you can't park it off the edge to "hide" it
  widgetWindow.on('moved', clampWidget);
  widgetWindow.on('resize', () => { clampWidget(); syncTierFromWidget(); });
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    broadcast();
  });
  syncTierFromWidget();
  // pull the freshest server balance whenever the widget opens
  fetchProfile();
  broadcast();
}

// Only our verified widget origin (or the bundled offline page) may load in the
// top frame; everything else is routed to the user's browser.
function isAllowedWidgetUrl(url) {
  if (typeof url !== 'string') return false;
  if (url.indexOf('file://') === 0) return true; // bundled offline widget
  try {
    const u = new URL(url);
    return u.origin === SITE_URL && u.pathname.indexOf('/widget') === 0;
  } catch (e) { return false; }
}

/* ---- drive the ad tier from the real widget window size ----
   Thresholds MUST match the widget page's setTier() (height-based) so the
   dashboard's "$/min (tier)" hint equals the tier the server actually credits. */
function tierForSize(w, h) {
  if (h >= 450) return 'large';
  if (h >= 300) return 'standard';
  return 'compact';
}
function syncTierFromWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const b = widgetWindow.getBounds();
  const t = tierForSize(b.width, b.height);
  if (t !== currentTier) { currentTier = t; broadcast(); }
}

/* keep the widget window fully inside the current display's work area */
function clampWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const b = widgetWindow.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
  if (Math.round(x) !== b.x || Math.round(y) !== b.y) {
    widgetWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
  }
}

/* ============================================================
   IPC
   ============================================================ */
ipcMain.handle('state:get', () => getState());

// Real Supabase email/password sign-in (direct REST, no SDK).
ipcMain.handle('auth:login', async (_e, payload) => {
  const email = (payload && payload.email ? String(payload.email) : '').trim();
  const password = payload && payload.password ? String(payload.password) : '';
  if (!email || !password) return { ok: false, reason: 'Enter your email and password' };
  try {
    const tok = await supaAuth('/auth/v1/token?grant_type=password', { email, password });
    storeSession(tok);
    await fetchProfile();
    broadcast();
    return { ok: true, state: getState() };
  } catch (e) {
    return { ok: false, reason: e.message || 'Sign in failed' };
  }
});

// Real Supabase sign-up. Some projects return a session immediately; if email
// confirmation is on, no session comes back and the user must confirm first.
ipcMain.handle('auth:signup', async (_e, payload) => {
  const email = (payload && payload.email ? String(payload.email) : '').trim();
  const password = payload && payload.password ? String(payload.password) : '';
  if (!email || !password) return { ok: false, reason: 'Enter your email and password' };
  if (password.length < 6) return { ok: false, reason: 'Password must be at least 6 characters' };
  try {
    const data = await supaAuth('/auth/v1/signup', { email, password });
    if (data && data.access_token) {
      storeSession(data);
      await fetchProfile();
      broadcast();
      return { ok: true, state: getState() };
    }
    // confirmation required — no session yet
    return { ok: true, confirm: true };
  } catch (e) {
    return { ok: false, reason: e.message || 'Sign up failed' };
  }
});

ipcMain.handle('auth:logout', () => {
  clearSession();
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  broadcast();
  return getState();
});

// Pull the live balance/lifetime from Supabase on demand (e.g. dashboard focus).
ipcMain.handle('profile:refresh', async () => { await fetchProfile(); return getState(); });

ipcMain.handle('widget:launch', () => {
  if (!accessToken()) return getState(); // can't earn without a signed-in session
  createWidgetWindow();
  return getState();
});
ipcMain.handle('widget:close', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  return getState();
});

ipcMain.handle('tier:set', (_e, tier) => {
  if (AD_RATES[tier]) { currentTier = tier; broadcast(); }
  return getState();
});

// Real, authenticated cash-out via Supabase request_cashout (enforces $5 min,
// debits balance atomically). This never zeroes the local balance — the server
// is the source of truth, and we re-sync the mirror afterward.
ipcMain.handle('cashout:request', async (_e, payload) => {
  const token = accessToken();
  if (!token) return { ok: false, reason: 'Sign in to cash out' };
  const method = payload && payload.method ? String(payload.method) : 'paypal';
  const destination = (payload && payload.destination ? String(payload.destination) : '').trim();
  if (!['paypal', 'venmo', 'cash_app'].includes(method)) {
    return { ok: false, reason: 'Choose a valid payout method' };
  }
  if (destination.length < 3) {
    // no destination collected in-app yet → send them to the web dashboard form
    shell.openExternal(SITE_URL + '/dashboard');
    return { ok: false, openedWeb: true, reason: 'Finish cash out on the web dashboard' };
  }
  const bal = Number(store.get('balance', 0)) || 0;
  if (bal < 5) return { ok: false, reason: 'Minimum cash out is $5.00' };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/request_cashout', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_amount: bal,
        p_method: method,
        p_destination: destination,
        p_request_key: crypto.randomUUID()
      })
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.hint)) || 'Cash out failed';
      return { ok: false, reason: msg };
    }
    const row = Array.isArray(data) ? data[0] : data;
    await fetchProfile(); // re-sync the real (now-debited) balance
    return { ok: true, amount: row ? Number(row.amount) : bal, status: row ? row.status : 'pending' };
  } catch (e) {
    return { ok: false, reason: e.message || 'Cash out failed' };
  }
});

ipcMain.handle('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  return true;
});

ipcMain.on('window:minimize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize();
});
ipcMain.on('window:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close();
});

/* ============================================================
   app lifecycle
   ============================================================ */
app.whenReady().then(() => {
  if (isMac && app.dock) { try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (e) {} }
  if (process.env.PP_SHOT) return runShot(process.env.PP_SHOT);
  createMainWindow();
  // restore a saved session: refresh the token if it's near/over expiry, then
  // pull the live balance so the dashboard never shows a stale local number
  const s = getSession();
  if (s && s.refresh_token) {
    if (!s.expires_at || s.expires_at - Date.now() < 60 * 1000) {
      refreshSession().then(() => fetchProfile());
    } else {
      scheduleRefresh(s);
      fetchProfile();
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });

/* ============================================================
   self-test screenshots (dev):  PP_SHOT=login|dashboard|widget npm start
   ============================================================ */
function runShot(mode) {
  const out = (name, win) => win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-' + name + '.png'), img.toPNG());
      } catch (e) { console.error(e); }
      app.quit();
    }, 1400);
  });
  if (mode === 'dashboard') {
    store.set('session', { access_token: 'demo', refresh_token: null, expires_at: Date.now() + 36e5, user: { email: 'you@gmail.com', id: 'demo' } });
    store.set('balance', 12.48); store.set('lifetime', 41.2);
    createMainWindow(); out('dashboard', mainWindow);
  } else if (mode === 'widget' || mode === 'widget-large') {
    createWidgetWindow();
    widgetWindow.webContents.once('did-finish-load', () => {
      if (mode === 'widget-large') widgetWindow.setSize(540, 460); // after load → resize event is caught
      setTimeout(async () => {
        try {
          const img = await widgetWindow.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, 'shot-' + mode + '.png'), img.toPNG());
        } catch (e) { console.error(e); }
        app.quit();
      }, 1600);
    });
  } else {
    store.set('session', null);
    createMainWindow(); out('login', mainWindow);
  }
}
