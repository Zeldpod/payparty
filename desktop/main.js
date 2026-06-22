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
const Store = require('electron-store');

const store = new Store({
  defaults: { user: null, balance: 0, lifetime: 0 }
});

/* ------------------------------------------------------------
   WIDGET PAGE URL
   In production this loads your hosted page (which contains the
   AdMaven integration). For local dev it falls back to the
   bundled widget.html so the app runs without deploying first.
   ------------------------------------------------------------ */
const REMOTE_WIDGET_URL = 'https://payparty.app/widget';
const LOCAL_WIDGET_URL = 'file://' + path.join(__dirname, 'windows', 'widget.html');
// Set PP_WIDGET_URL=remote to test the live page once it's deployed.
const WIDGET_URL =
  process.env.PP_WIDGET_URL === 'remote' ? REMOTE_WIDGET_URL :
  process.env.PP_WIDGET_URL ? process.env.PP_WIDGET_URL :
  LOCAL_WIDGET_URL;

const isMac = process.platform === 'darwin';
const preload = path.join(__dirname, 'preload.js');

let mainWindow = null;
let widgetWindow = null;
let earnTimer = null;

/* ---- ad tiers: bigger widget → higher-paying format ----
   Rates are placeholders ($/min). When real ads are wired, the tier maps to
   an AdMaven format (compact=banner, standard=in-page push, large=video) and
   real revenue comes from AdMaven postbacks instead of this timer. */
const AD_RATES = { compact: 0.02, standard: 0.05, large: 0.15 };
let currentTier = 'standard';

/* ---------- shared state ---------- */
function getState() {
  return {
    user: store.get('user', null),
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
function addEarnings(amount) {
  const amt = Math.max(0, Number(amount) || 0);
  store.set('balance', (store.get('balance', 0) || 0) + amt);
  store.set('lifetime', (store.get('lifetime', 0) || 0) + amt);
  broadcast();
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
  const W = 380, H = 340;
  widgetWindow = new BrowserWindow({
    width: W,
    height: H,
    minWidth: 300,   // can't shrink it into nothing (anti-cheat: ad must stay visible)
    minHeight: 240,
    maxWidth: 620,
    maxHeight: 560,
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
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
  if (typeof widgetWindow.setVisibleOnAllWorkspaces === 'function') {
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  widgetWindow.loadURL(WIDGET_URL);
  // keep the widget fully on screen — you can't park it off the edge to "hide" it
  widgetWindow.on('moved', clampWidget);
  widgetWindow.on('resize', clampWidget);
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    stopEarnLoop();
    broadcast();
  });
  startEarnLoop();
  broadcast();
}

/* ---------- passive "screen active" earnings while widget is open ----------
   Simulates the sponsor revenue share. Replace with real server-confirmed
   ad-impression callbacks when your backend + AdMaven postbacks are wired. */
function startEarnLoop() {
  stopEarnLoop();
  // tick every 5s; per-tick = (tier $/min) / 12
  earnTimer = setInterval(() => addEarnings((AD_RATES[currentTier] || 0.02) / 12), 5000);
}
function stopEarnLoop() {
  if (earnTimer) { clearInterval(earnTimer); earnTimer = null; }
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

ipcMain.handle('auth:login', (_e, payload) => {
  // MOCK AUTH — replace with a real call to your auth backend / OAuth.
  const email = (payload && payload.email ? String(payload.email) : '').trim();
  const provider = payload && payload.provider ? String(payload.provider) : 'email';
  store.set('user', {
    email: email || (provider + '@payparty.app'),
    provider,
    joined: Date.now()
  });
  broadcast();
  return getState();
});

ipcMain.handle('auth:logout', () => {
  store.set('user', null);
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  broadcast();
  return getState();
});

ipcMain.handle('widget:launch', () => { createWidgetWindow(); return getState(); });
ipcMain.handle('widget:close', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  return getState();
});

ipcMain.handle('earn:add', (_e, amount) => { addEarnings(amount); return getState(); });

ipcMain.handle('tier:set', (_e, tier) => {
  if (AD_RATES[tier]) { currentTier = tier; broadcast(); }
  return getState();
});

ipcMain.handle('cashout:request', () => {
  // MOCK — wire to your payout provider (Cash App / PayPal / Venmo).
  const bal = store.get('balance', 0);
  if (bal < 5) return { ok: false, reason: 'Minimum cash out is $5.00' };
  store.set('balance', 0);
  broadcast();
  return { ok: true, amount: Math.round(bal * 100) / 100 };
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
    store.set('user', { email: 'you@gmail.com', provider: 'email', joined: Date.now() });
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
    store.set('user', null);
    createMainWindow(); out('login', mainWindow);
  }
}
