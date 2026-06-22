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
      : '<span class="live" style="opacity:.5"><i style="background:#bbb;box-shadow:none"></i></span> widget paused';
    $('#launch').classList.toggle('on', on);
    $('#launch-t').textContent = on ? '■ Stop widget' : '▶ Launch widget';
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

/* ---- login ---- */
document.querySelectorAll('[data-provider]').forEach(b => {
  b.addEventListener('click', async () => {
    render(await pp.login({ provider: b.dataset.provider }));
    toast('Signed in — welcome to the party 🎉');
  });
});
$('#login-email').addEventListener('click', login);
$('#email').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
async function login() {
  const email = $('#email').value.trim();
  if (!/.+@.+\..+/.test(email)) { toast('Enter a valid email'); return; }
  render(await pp.login({ email, provider: 'email' }));
  toast('Signed in — welcome to the party 🎉');
}

/* ---- dashboard ---- */
$('#logout').addEventListener('click', async () => { render(await pp.logout()); });
$('#launch').addEventListener('click', async () => {
  const s = await pp.getState();
  if (s.widgetOpen) { render(await pp.closeWidget()); }
  else { render(await pp.launchWidget()); toast('Widget launched — drag it anywhere'); }
});
$('#cashout').addEventListener('click', async () => {
  const r = await pp.cashOut();
  toast(r.ok ? 'Cashing out ' + money(r.amount) + ' 💸' : r.reason);
});

/* ---- live updates ---- */
pp.onUpdate(render);
pp.getState().then(render);
