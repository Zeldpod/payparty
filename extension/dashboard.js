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
