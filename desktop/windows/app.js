'use strict';
/* Main window: login ↔ dashboard, driven by main-process state. */
const pp = window.payparty;
const $ = (s) => document.querySelector(s);

if (pp && pp.platform === 'darwin') document.body.classList.add('mac');

function money(n) { return '$' + (Math.round((n || 0) * 100) / 100).toFixed(2); }
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function render(state) {
  if (!state) return;
  if (state.user) {
    show('dash');
    $('#who').textContent = (state.user.email || 'friend').split('@')[0];
    $('#balance').textContent = money(state.balance);
    $('#lifetime').textContent = money(state.lifetime) + ' earned all-time';
    const on = state.widgetOpen;
    $('#status').innerHTML = on
      ? '<span class="live"><i></i></span> earning · $' + (state.rate || 0).toFixed(2) + '/min (' + (state.tier || 'standard') + ')'
      : '<span class="live" style="opacity:.5"><i style="background:#bbb;box-shadow:none;animation:none"></i></span> widget paused';
    $('#launch').classList.toggle('on', on);
    $('#launch-t').textContent = on ? 'Stop widget' : 'Launch widget';
    $('#launch-d').textContent = on
      ? 'The sponsored card is live on your screen.'
      : 'Drop the sponsored card on your screen and start earning.';
    const co = $('#cashout');
    co.disabled = state.balance < 5;
    co.textContent = state.balance >= 5 ? 'Cash out ' + money(state.balance) : 'Cash out';
  } else {
    show('login');
  }
}

/* ---- window controls ---- */
$('#min').addEventListener('click', () => pp.minimize());
$('#close').addEventListener('click', () => pp.close());

/* ---- login / sign up (real Supabase email + password) ---- */
let mode = 'signin'; // 'signin' | 'signup'
function applyMode() {
  const signup = mode === 'signup';
  $('#login-label').textContent = signup ? 'Create account →' : 'Sign in →';
  $('#auth-switch-text').textContent = signup ? 'Already have an account?' : 'New to PayParty?';
  $('#auth-switch').textContent = signup ? 'Sign in' : 'Create an account';
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
}
$('#auth-switch').addEventListener('click', (e) => {
  e.preventDefault();
  mode = mode === 'signin' ? 'signup' : 'signin';
  applyMode();
});
applyMode();

// Google is OAuth-only: fall back to the verified web login in the browser.
$('#google-web').addEventListener('click', () => {
  pp.openExternal('https://www.payparty.fun/login');
  toast('Finish Google sign in in your browser');
});

$('#login-email').addEventListener('click', submitAuth);
$('#email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#password').focus(); });
$('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
async function submitAuth() {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!/.+@.+\..+/.test(email)) { toast('Enter a valid email'); return; }
  if (!password) { toast('Enter your password'); return; }
  const btn = $('#login-email'); btn.disabled = true;
  try {
    const r = mode === 'signup'
      ? await pp.signup({ email, password })
      : await pp.login({ email, password });
    if (!r.ok) { toast(r.reason || 'Something went wrong'); return; }
    if (r.confirm) { toast('Check your email to confirm your account'); mode = 'signin'; applyMode(); return; }
    render(r.state);
    toast('Signed in — welcome to the party 🎉');
  } finally { btn.disabled = false; }
}

/* ---- dashboard ---- */
$('#logout').addEventListener('click', async () => { render(await pp.logout()); });
$('#launch').addEventListener('click', async () => {
  const s = await pp.getState();
  if (s.widgetOpen) { render(await pp.closeWidget()); }
  else { render(await pp.launchWidget()); toast('Widget launched — drag it anywhere'); }
});
// keep the destination placeholder honest as the method changes
$('#cashout-method').addEventListener('change', (e) => {
  const ph = { paypal: 'PayPal email', venmo: 'Venmo @handle', cash_app: 'Cash App $cashtag' };
  $('#cashout-dest').placeholder = ph[e.target.value] || 'Payout destination';
});
$('#cashout').addEventListener('click', async () => {
  const method = $('#cashout-method').value;
  const destination = $('#cashout-dest').value.trim();
  const btn = $('#cashout'); btn.disabled = true;
  try {
    const r = await pp.cashOut({ method, destination });
    if (r.ok) { toast('Cashing out ' + money(r.amount) + ' 💸'); $('#cashout-dest').value = ''; }
    else if (!r.openedWeb) { toast(r.reason); }
    else { toast(r.reason); }
  } finally { btn.disabled = false; }
});

/* ---- live updates ---- */
pp.onUpdate(render);
pp.getState().then(render);
// dashboard regained focus → re-sync the real balance from Supabase
window.addEventListener('focus', () => { pp.refreshProfile().then(render); });
