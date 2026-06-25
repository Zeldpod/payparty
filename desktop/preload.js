'use strict';
/* Secure bridge between the renderer pages and the main process.
   Exposed on every window (main + widget, local or remote) as window.payparty */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('payparty', {
  platform: process.platform,
  // auth (real Supabase email/password via main.js → REST)
  login: (payload) => ipcRenderer.invoke('auth:login', payload),
  signup: (payload) => ipcRenderer.invoke('auth:signup', payload),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // state
  getState: () => ipcRenderer.invoke('state:get'),
  refreshProfile: () => ipcRenderer.invoke('profile:refresh'),
  onUpdate: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('state:update', fn);
    return () => ipcRenderer.removeListener('state:update', fn);
  },
  // widget control
  launchWidget: () => ipcRenderer.invoke('widget:launch'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  // payouts (real, authenticated request_cashout)
  cashOut: (payload) => ipcRenderer.invoke('cashout:request', payload),
  // widget size → ad tier
  setTier: (tier) => ipcRenderer.invoke('tier:set', tier),
  // misc
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
