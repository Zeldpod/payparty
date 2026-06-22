'use strict';
/* ============================================================
   PayParty widget — glass card + AdMaven web ad integration
   + size-based ad tiers (bigger widget → higher-paying format)
   ============================================================
   ADMAVEN — paste your zone values to go live. Tiers map to formats:
     compact  → small banner            (lowest pay)
     standard → In-Page Push / card     (mid)
     large    → Interstitial / Video    (highest pay)
   Real revenue should come from AdMaven server postbacks; the in-app
   counter is a placeholder until that's wired.
   ============================================================ */
const ADMAVEN = {
  inpagePushSrc: '',     // In-Page Push / Floating Banner zone src
  inpagePushTag: '',     // OR a raw <script>…</script> snippet
  interstitialSrc: '',   // Interstitial zone src (used by "Fullscreen offer" + large tier)
  smartlink: ''          // Direct Link / Smartlink URL (100% fill → "View sponsor")
};

/* fallback so the page also works opened in a plain browser */
const pp = window.payparty || {
  platform: 'web',
  addEarnings() {}, setTier() {}, closeWidget() { try { window.close(); } catch (e) {} },
  openExternal(u) { window.open(u, '_blank', 'noopener'); },
  onUpdate() {}, getState() { return Promise.resolve({ balance: 0 }); }
};
const $ = (s) => document.querySelector(s);
const card = $('#card');

/* ---------- size → tier ---------- */
const RATE_LABEL = { compact: '$0.02/min', standard: '$0.05/min', large: '$0.15/min' };
const TIER_NAME = { compact: 'Sponsored', standard: 'Sponsored', large: 'Sponsored video' };
function pickTier() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w >= 470 && h >= 380) return 'large';
  if (w >= 360 && h >= 290) return 'standard';
  return 'compact';
}
let tier = null;
function applyTier() {
  const t = pickTier();
  if (t === tier) return;
  const up = tier && ['compact', 'standard', 'large'].indexOf(t) > ['compact', 'standard', 'large'].indexOf(tier);
  tier = t;
  card.className = 'card tier-' + t;
  $('#rate').textContent = RATE_LABEL[t];
  $('#tag-label').textContent = TIER_NAME[t];
  pp.setTier(t);
  chooseNetworkAd(t);
  if (up) flash('Bigger widget → <b>' + RATE_LABEL[t] + '</b>');
}
let raf;
window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(applyTier); });

function flash(html) {
  const f = $('#flash'); f.innerHTML = html;
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
}

/* ---------- AdMaven creatives per tier ---------- */
function injectScript(src) { const s = document.createElement('script'); s.src = src; s.async = true; document.body.appendChild(s); return s; }
function injectTag(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script');
    [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
    s.textContent = old.textContent; document.body.appendChild(s);
  });
}
let networkLoaded = false;
function chooseNetworkAd(t) {
  // In-Page Push fits compact/standard; (interstitial/video for large fires on intent)
  if (networkLoaded) return;
  if (ADMAVEN.inpagePushTag) { injectTag(ADMAVEN.inpagePushTag); networkLoaded = true; }
  else if (ADMAVEN.inpagePushSrc) {
    const s = injectScript(ADMAVEN.inpagePushSrc); s.setAttribute('data-container', 'admaven-slot'); networkLoaded = true;
  }
  if (networkLoaded) {
    $('#admaven-slot').classList.add('on');
    $('#house').classList.add('network-hidden');
    $('#video').classList.add('network-hidden');
  }
  void t;
}

/* ---------- Smartlink / Interstitial ---------- */
function popCoin(text) { const c = $('#coin'); c.textContent = text; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = 'coin 1.5s ease-out'; }
function openSponsor() {
  if (ADMAVEN.smartlink) pp.openExternal(ADMAVEN.smartlink);
  const bonus = tier === 'large' ? 0.15 : tier === 'standard' ? 0.05 : 0.02;
  pp.addEarnings(bonus); popCoin('+$' + bonus.toFixed(2));
  if (!ADMAVEN.smartlink) flash('Add your AdMaven <b>Smartlink</b> in widget.js');
}
function fireInterstitial() { if (ADMAVEN.interstitialSrc) { injectScript(ADMAVEN.interstitialSrc); return true; } return false; }

/* ---------- wire up ---------- */
$('#close').addEventListener('click', () => pp.closeWidget());
$('#cta').addEventListener('click', openSponsor);
$('#more').addEventListener('click', () => { if (!fireInterstitial()) openSponsor(); });

/* earnings display + coin on passive accrual */
let lastBal = null;
pp.onUpdate((s) => {
  if (!s) return;
  $('#earn').textContent = '$' + (s.balance || 0).toFixed(2) + ' today';
  if (lastBal !== null && s.balance > lastBal + 0.001) popCoin('+$' + (s.balance - lastBal).toFixed(2));
  lastBal = s.balance;
});
pp.getState().then((s) => { lastBal = s.balance || 0; $('#earn').textContent = '$' + lastBal.toFixed(2) + ' today'; });

/* cosmetic video progress (only seen on large tier) */
let vp = 8;
setInterval(() => {
  vp = (vp + 4) % 100;
  const i = $('#vprog'); if (i) i.style.width = Math.max(8, vp) + '%';
  const tEl = $('#vtime'); if (tEl) { const left = Math.max(0, 15 - Math.floor(vp / 100 * 15)); tEl.textContent = '0:' + String(left).padStart(2, '0'); }
}, 700);

/* boot */
applyTier();
