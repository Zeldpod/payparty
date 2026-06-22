'use strict';
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
// bundled extension dashboard (always works, no domain needed).
// Once payparty.app is deployed you can switch this to 'https://payparty.app/dashboard.html'.
const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

function render(s) {
  $('#bal').textContent = money(s.balance);
  $('#life').textContent = money(s.lifetime) + ' all-time';
  $('#sw').classList.toggle('on', s.enabled !== false);
}

chrome.storage.local.get(['enabled', 'balance', 'lifetime']).then(render);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') chrome.storage.local.get(['enabled', 'balance', 'lifetime']).then(render); });

$('#sw').addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !(enabled !== false) });
});
$('#dash').addEventListener('click', () => chrome.tabs.create({ url: DASHBOARD_URL }));
