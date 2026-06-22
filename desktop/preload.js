'use strict';
/* Secure bridge between the renderer pages and the main process.
   Exposed on every window (main + widget, local or remote) as window.payparty */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('payparty', {
  platform: process.platform,
  // auth (mock today — swap main.js handlers for your real backend)
  login: (payload) => ipcRenderer.invoke('auth:login', payload),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // state
  getState: () => ipcRenderer.invoke('state:get'),
  onUpdate: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('state:update', fn);
    return () => ipcRenderer.removeListener('state:update', fn);
  },
  // widget control
  launchWidget: () => ipcRenderer.invoke('widget:launch'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  // earnings + payouts
  addEarnings: (amt) => ipcRenderer.invoke('earn:add', amt),
  cashOut: () => ipcRenderer.invoke('cashout:request'),
  // widget size → ad tier
  setTier: (tier) => ipcRenderer.invoke('tier:set', tier),
  // misc
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
