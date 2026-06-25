'use strict';
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
// bundled extension dashboard (always works, no domain needed).
const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

let mode = 'signin'; // 'signin' | 'signup'

/* ---------- signed-in balance/state rendering ---------- */
function renderState(s) {
  $('#bal').textContent = money(s.balance);
  $('#life').textContent = money(s.lifetime) + ' all-time';
  $('#sw').classList.toggle('on', s.enabled !== false);
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local') chrome.storage.local.get(['enabled', 'balance', 'lifetime']).then(renderState);
});

/* ---------- show auth vs app based on session ---------- */
async function refreshView() {
  const sess = await PPAuth.getSession();
  const signedIn = !!(sess && sess.access_token);
  $('#auth').classList.toggle('hidden', signedIn);
  $('#app').classList.toggle('hidden', !signedIn);
  if (signedIn) {
    $('#who').textContent = (sess.user && sess.user.email) || 'Signed in';
    chrome.storage.local.get(['enabled', 'balance', 'lifetime']).then(renderState);
    // pull the REAL balance from Supabase (also mirrors into storage)
    PPAuth.fetchBalance();
  } else {
    setMode('signin');
  }
}

/* ---------- auth form ---------- */
function setMode(m) {
  mode = m;
  $('#err').textContent = '';
  $('#primary').textContent = m === 'signup' ? 'Create account' : 'Sign in';
  $('#toggleTxt').textContent = m === 'signup' ? 'Already have an account?' : 'New here?';
  $('#toggle').textContent = m === 'signup' ? 'Sign in' : 'Create an account';
  $('#pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
}

$('#toggle').addEventListener('click', () => setMode(mode === 'signup' ? 'signin' : 'signup'));

async function submit() {
  const email = $('#email').value.trim();
  const pass = $('#pass').value;
  const err = $('#err');
  err.style.color = '';
  err.textContent = '';
  if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
  const btn = $('#primary');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
  try {
    if (mode === 'signup') {
      const r = await PPAuth.signUp(email, pass);
      if (r && r.needsConfirm) {
        err.style.color = '#00a344';
        err.textContent = 'Check your email to confirm, then sign in.';
        setMode('signin');
        return;
      }
    } else {
      await PPAuth.signIn(email, pass);
    }
    await refreshView();
  } catch (e) {
    err.textContent = (e && e.message) || 'Something went wrong.';
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
$('#primary').addEventListener('click', submit);
$('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

// Google → web-login fallback (opens hosted login in a new tab)
$('#google').addEventListener('click', () => chrome.tabs.create({ url: PPAuth.WEB_LOGIN }));

/* ---------- signed-in actions ---------- */
$('#signout').addEventListener('click', async () => { await PPAuth.signOut(); await refreshView(); });
$('#sw').addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !(enabled !== false) });
});
$('#dash').addEventListener('click', () => chrome.tabs.create({ url: DASHBOARD_URL }));

refreshView();
