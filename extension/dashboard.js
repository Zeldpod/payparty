'use strict';
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
const RATE = { compact: 0.02, standard: 0.05, large: 0.15 };
function render(s) {
  $('#balance').textContent = money(s.balance);
  $('#lifetime').textContent = money(s.lifetime) + ' earned all-time';
  $('#sw').classList.toggle('on', s.enabled !== false);
  const tier = s.tier || 'standard';
  $('#tier').textContent = tier;
  $('#rate').textContent = '$' + (RATE[tier] || 0.05).toFixed(2) + '/min';
}
const KEYS = ['enabled', 'balance', 'lifetime', 'tier'];
chrome.storage.local.get(KEYS).then(render);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') chrome.storage.local.get(KEYS).then(render); });
$('#sw').addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !(enabled !== false) });
});

// Reflect Supabase sign-in state and pull the REAL balance when signed in.
async function syncAuth() {
  const sess = await PPAuth.getSession();
  const signedIn = !!(sess && sess.access_token);
  const pill = $('#signin');
  const note = $('#note');
  if (signedIn) {
    pill.textContent = (sess.user && sess.user.email) || 'Signed in';
    note.innerHTML = 'Synced to your PayParty account. Balance updates in real time across desktop, browser &amp; web.';
    PPAuth.fetchBalance(); // writes balance/lifetime to storage → re-renders
  } else {
    pill.textContent = 'Sign in to sync';
    note.innerHTML = 'Open the extension popup to <b>sign in</b> and sync your real balance across desktop, browser &amp; web.';
  }
}
syncAuth();
