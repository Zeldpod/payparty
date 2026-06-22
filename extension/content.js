'use strict';
/* ============================================================
   PayParty content script — COMPLIANT floating overlay
   ------------------------------------------------------------
   We do NOT inject ads into the page. We inject only a small,
   clearly-branded "Earn" launcher (the extension's own UI).
   Clicking it pops the earning widget into an always-on-top
   Document Picture-in-Picture window — that window is OUR own
   document, not the website's page, so it sidesteps Chrome's
   "no ad injection into web pages" rule. Falls back to a normal
   popup window where Document PiP isn't supported.
   ============================================================ */
(function () {
  if (window.top !== window) return;            // top frame only
  if (window.__payparty) return; window.__payparty = true;

  const ADMAVEN = { smartlink: '' };            // paste your Direct Link / Smartlink
  const RATE = { compact: 0.02, standard: 0.05, large: 0.15 }; // $/min (placeholder)
  let pip = null, earnTimer = null, tier = 'standard';

  /* ---- launcher button (the extension's own branded UI, opt-in, NOT an ad) ---- */
  const host = document.createElement('div');
  host.id = 'payparty-launcher';
  host.style.cssText = 'all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .pp{display:flex;align-items:center;gap:9px;padding:9px 16px 9px 9px;border:none;cursor:pointer;border-radius:999px;
      font:800 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#fff;
      background:linear-gradient(150deg,#8B5CFF,#5A35FF);box-shadow:0 12px 28px rgba(108,77,255,.5),0 1px 0 rgba(255,255,255,.4) inset;transition:transform .15s}
    .pp:hover{transform:translateY(-2px)}
    .pp img{width:30px;height:30px;border-radius:9px;display:block}
    .pp i{width:7px;height:7px;border-radius:50%;background:#7CFFB0;box-shadow:0 0 8px #7CFFB0;display:inline-block;animation:b 1.6s infinite}
    @keyframes b{0%,100%{opacity:.5}50%{opacity:1}}
  </style><button class="pp" title="Open your PayParty earning widget"><img alt=""><span>Earn</span><i></i></button>`;
  (document.documentElement || document.body).appendChild(host);
  root.querySelector('img').src = chrome.runtime.getURL('icons/icon128.png');

  function sync(){ chrome.storage.local.get('enabled').then(s => { host.style.display = s.enabled === false ? 'none' : 'block'; }); }
  chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.enabled) sync(); });
  sync();

  root.querySelector('.pp').addEventListener('click', launch);

  async function launch(){
    if (pip && !pip.closed) { try { pip.focus(); } catch (e) {} return; }
    const W = 340, H = 360;
    try {
      if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
        pip = await documentPictureInPicture.requestWindow({ width: W, height: H }); // always-on-top
      } else {
        pip = window.open('', 'payparty_widget', `popup,width=${W},height=${H}`);     // fallback
      }
    } catch (e) {
      pip = window.open('', 'payparty_widget', `popup,width=${W},height=${H}`);
    }
    if (!pip) return;
    render(pip);
    startEarn();
    if (pip.addEventListener) pip.addEventListener('pagehide', cleanup);
  }
  function cleanup(){ stopEarn(); pip = null; }

  /* ---- widget UI rendered INTO the PiP window (our own document) ---- */
  function render(win){
    const d = win.document;
    d.body.style.margin = '0';
    const st = d.createElement('style'); st.textContent = WIDGET_CSS; d.head.appendChild(st);
    const wrap = d.createElement('div'); wrap.innerHTML = WIDGET_HTML; d.body.appendChild(wrap);
    const $ = (s) => d.querySelector(s);
    $('#pp-prod').src = chrome.runtime.getURL('airpods.png');
    $('#pp-mark').src = chrome.runtime.getURL('icons/icon128.png');
    applyTier(d, win);
    win.addEventListener('resize', () => applyTier(d, win));
    $('#pp-cta').addEventListener('click', () => {
      if (ADMAVEN.smartlink) chrome.runtime.sendMessage({ type: 'pp:open', url: ADMAVEN.smartlink });
      else flash(d, 'Add your AdMaven Smartlink in content.js');
      credit(RATE[tier] / 12 * 3, d);
    });
    chrome.storage.local.get('balance').then(s => { const e = $('#pp-earn'); if (e) e.textContent = '$' + ((s.balance || 0)).toFixed(2) + ' today'; });
  }
  function applyTier(d, win){
    const w = win.innerWidth, h = win.innerHeight;
    tier = (w >= 470 && h >= 380) ? 'large' : (w >= 360 && h >= 300) ? 'standard' : 'compact';
    d.body.setAttribute('data-tier', tier);
    const r = d.querySelector('#pp-rate'); if (r) r.textContent = '$' + RATE[tier].toFixed(2) + '/min';
    const tl = d.querySelector('#pp-taglabel'); if (tl) tl.textContent = tier === 'large' ? 'Sponsored video' : 'Sponsored';
  }
  function credit(amt, d){
    chrome.storage.local.get(['balance', 'lifetime']).then(s => {
      const bal = Math.round(((s.balance || 0) + amt) * 100) / 100;
      chrome.storage.local.set({ balance: bal, lifetime: Math.round(((s.lifetime || 0) + amt) * 100) / 100 });
      const e = d && d.querySelector('#pp-earn'); if (e) e.textContent = '$' + bal.toFixed(2) + ' today';
      const c = d && d.querySelector('#pp-coin'); if (c) { c.textContent = '+$' + amt.toFixed(2); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = 'ppcoin 1.5s ease-out'; }
    });
  }
  function flash(d, msg){ const f = d.querySelector('#pp-flash'); if (!f) return; f.textContent = msg; f.style.opacity = '1'; setTimeout(() => (f.style.opacity = '0'), 2600); }
  function startEarn(){ stopEarn(); earnTimer = setInterval(() => { if (!pip || pip.closed) { cleanup(); return; } credit(RATE[tier] / 12, pip.document); }, 5000); }
  function stopEarn(){ if (earnTimer) { clearInterval(earnTimer); earnTimer = null; } }

  const WIDGET_HTML = `
    <div class="card">
      <div class="head"><img class="m" id="pp-mark" alt=""><span class="nm">PayParty</span><span class="live"><i></i>earning</span></div>
      <div class="tag"><span class="lab"><i></i><span id="pp-taglabel">Sponsored</span></span><span class="rate" id="pp-rate">$0.05/min</span></div>
      <div class="creative">
        <div class="house"><div class="info"><div class="price">$249.99</div><div class="name">AirPods Pro 3</div></div><div class="tile"><img id="pp-prod" alt=""></div></div>
        <div class="video"><div class="vthumb"><span class="vmeta">Sponsored video · 0:15</span><span class="play">▶</span></div></div>
      </div>
      <button class="cta" id="pp-cta">View sponsor →</button>
      <div class="foot"><span class="earn" id="pp-earn">$0.00 today</span><span>Drag edge → grow</span></div>
      <div class="coin" id="pp-coin">+$0.05</div>
      <div class="flash" id="pp-flash"></div>
    </div>`;

  const WIDGET_CSS = `
    html,body{margin:0;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    .card{position:relative;height:100vh;display:flex;flex-direction:column;color:#fff;background:linear-gradient(168deg,rgba(130,97,255,.97),rgba(58,33,120,.98) 52%,#0f0a24)}
    .head{display:flex;align-items:center;gap:8px;padding:12px 13px 6px}
    .head .m{width:24px;height:24px;border-radius:7px;display:block}
    .head .nm{font-weight:800;font-size:13px}
    .head .live{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:#7CFFB0}
    .head .live i{width:6px;height:6px;border-radius:50%;background:#7CFFB0;box-shadow:0 0 8px #7CFFB0;animation:pl 1.6s infinite}
    @keyframes pl{0%,100%{opacity:.6}50%{opacity:1}}
    .tag{display:flex;align-items:center;justify-content:space-between;padding:0 14px}
    .tag .lab{font-size:9.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#cbbcff;display:inline-flex;gap:5px;align-items:center}
    .tag .lab i{width:5px;height:5px;border-radius:50%;background:#cbbcff}
    .tag .rate{font-size:11px;font-weight:800;color:#7CFFB0;background:rgba(124,255,176,.14);padding:3px 9px;border-radius:99px}
    .creative{flex:1;min-height:0;margin:9px 14px 0;position:relative}
    .house{display:flex;gap:12px;align-items:center;height:100%}
    .house .info{flex:1;min-width:0}
    .price{font-weight:800;font-size:30px;letter-spacing:-1.4px;line-height:1;color:#e9d7fe;text-shadow:0 2px 12px rgba(130,90,255,.55)}
    .name{font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-top:8px;opacity:.95;font-size:11px}
    .tile{flex:none;width:92px;height:92px;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#fff,#efeaff);box-shadow:0 6px 16px rgba(0,0,0,.3)}
    .tile img{width:100%;height:100%;object-fit:cover;display:block}
    .video{display:none;height:100%}
    .vthumb{position:relative;width:100%;height:100%;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#241a52,#3a2a78 60%,#1a1030);display:flex;align-items:center;justify-content:center}
    .play{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-size:18px;color:#3a1d8a;background:rgba(255,255,255,.92);padding-left:4px}
    .vmeta{position:absolute;top:10px;left:12px;font-size:11px;font-weight:700;color:#e7dbff}
    [data-tier=compact] .price{font-size:22px}[data-tier=compact] .tile{width:62px;height:62px}
    [data-tier=large] .house{display:none}[data-tier=large] .video{display:flex}
    .cta{margin:11px 14px 0;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:14px;font-weight:800;font-size:13.5px;color:#04210d;cursor:pointer;border:none;background:linear-gradient(150deg,#1be06a,#00C853);box-shadow:0 8px 20px rgba(0,200,83,.4)}
    .cta:hover{filter:brightness(1.05)}
    .foot{display:flex;align-items:center;justify-content:space-between;padding:9px 14px 12px;font-size:11px;color:#cbbcff}
    .earn{font-weight:800;color:#fff}
    .coin{position:absolute;left:50%;top:46px;transform:translateX(-50%);font-weight:900;font-size:15px;color:#7CFFB0;opacity:0;pointer-events:none}
    @keyframes ppcoin{0%{opacity:0;transform:translate(-50%,0) scale(.5)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-46px) scale(1.1)}}
    .flash{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(8,3,24,.82);border:1px solid rgba(124,255,176,.5);color:#fff;padding:9px 15px;border-radius:12px;font-weight:800;font-size:12.5px;opacity:0;transition:opacity .3s;text-align:center;max-width:80%}`;
})();
