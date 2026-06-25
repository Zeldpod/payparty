'use strict';
/* PayParty extension — service worker.
   Holds the on/off + balance state and tells tabs to show/hide the widget. */

const DEFAULTS = { enabled: true, balance: 0, lifetime: 0, tier: 'standard' };

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const next = {};
  for (const k in DEFAULTS) if (cur[k] === undefined) next[k] = DEFAULTS[k];
  if (Object.keys(next).length) await chrome.storage.local.set(next);
});

// open external links (sponsor offers) safely
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'pp:open' && /^https?:\/\//i.test(msg.url || '')) {
    chrome.tabs.create({ url: msg.url });
    reply && reply({ ok: true });
  }
  if (msg && msg.type === 'pp:get') {
    chrome.storage.local.get(Object.keys(DEFAULTS)).then(reply);
    return true;
  }
});
