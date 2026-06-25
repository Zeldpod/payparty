'use strict';
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
const RATE = { compact: 0.02, standard: 0.05, large: 0.15 };
function render(s) {
  $('#balance').textContent = money(s.balance);
  $('#lifetime').textContent = money(s.lifetime) + ' earned all-time';
  const on = s.enabled !== false;
  $('#sw').classList.toggle('on', on);
  $('#sw').setAttribute('aria-checked', String(on));
  const tier = s.tier || 'standard';
  $('#tier').textContent = tier;
  $('#rate').textContent = '$' + (RATE[tier] || 0.05).toFixed(2) + '/min';
}
const KEYS = ['enabled', 'balance', 'lifetime', 'tier'];
chrome.storage.local.get(KEYS).then(render);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') chrome.storage.local.get(KEYS).then(render); });
async function toggleEnabled() {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !(enabled !== false) });
}
$('#sw').addEventListener('click', toggleEnabled);
$('#sw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEnabled(); }
});

// Reflect Supabase sign-in state and pull the REAL balance when signed in.
async function syncAuth() {
  const sess = await PPAuth.getSession();
  const signedIn = !!(sess && sess.access_token);
  const pill = $('#signin');
  const pillText = pill.querySelector('.tx');
  const noteText = $('#note').querySelector('span:last-child');
  if (signedIn) {
    pill.classList.add('live');
    if (pillText) pillText.textContent = (sess.user && sess.user.email) || 'Signed in';
    if (noteText) noteText.innerHTML = 'Synced to your PayParty account. Balance updates in real time across desktop, browser &amp; web.';
    PPAuth.fetchBalance(); // writes balance/lifetime to storage → re-renders
  } else {
    pill.classList.remove('live');
    if (pillText) pillText.textContent = 'Sign in to sync';
    if (noteText) noteText.innerHTML = 'Open the extension popup to <b>sign in</b> and sync your real balance across desktop, browser &amp; web.';
  }
}
syncAuth();
