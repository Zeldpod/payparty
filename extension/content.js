'use strict';
/* PayParty content script — injects the floating glass-card widget into pages.
   Shadow DOM (no style clashes) · draggable · resizable→ad tiers · clamped to
   the viewport (can't be parked off-screen) · AdMaven smartlink + house ad. */
(function () {
  if (window.top !== window) return;            // top frame only
  if (window.__payparty_injected) return;
  window.__payparty_injected = true;

  /* paste your AdMaven Direct Link / Smartlink (100% fill) */
  const ADMAVEN = { smartlink: '' };
  const RATE = { compact: 0.02, standard: 0.05, large: 0.15 }; // $/min (placeholder)
  const MIN = { w: 300, h: 240 }, MAX = { w: 620, h: 560 };

  const host = document.createElement('div');
  host.id = 'payparty-widget-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  (document.body || document.documentElement).appendChild(host);

  root.innerHTML = `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap');
    :host,*{box-sizing:border-box}
    .pp{position:fixed;right:20px;bottom:20px;width:380px;height:340px;display:flex;font-family:'Hanken Grotesk',system-ui,sans-serif}
    .card{position:relative;flex:1;display:flex;flex-direction:column;border-radius:24px;overflow:hidden;color:#fff;
      background:linear-gradient(168deg,rgba(130,97,255,.92),rgba(58,33,120,.95) 48%,rgba(16,9,36,.98));
      border:1px solid rgba(255,255,255,.22);
      box-shadow:inset 0 1px 3px rgba(255,255,255,.85),inset 0 12px 22px rgba(160,142,236,.4),inset 0 40px 60px rgba(96,64,228,.45),0 24px 60px rgba(20,10,45,.5)}
    .head{display:flex;align-items:center;gap:8px;padding:12px 13px 6px;cursor:grab;user-select:none}
    .head.grabbing{cursor:grabbing}
    .m{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;color:#fff;font-weight:900;font-size:12px;background:linear-gradient(150deg,#8B5CFF,#6C4DFF)}
    .nm{font-weight:800;font-size:13px}
    .live{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:#7CFFB0}
    .live i{width:6px;height:6px;border-radius:50%;background:#7CFFB0;box-shadow:0 0 8px #7CFFB0;animation:pulse 1.6s infinite}
    .x{width:20px;height:20px;display:grid;place-items:center;border-radius:6px;color:#d8ccff;font-size:13px;cursor:pointer;margin-left:4px}
    .x:hover{background:rgba(255,255,255,.16)}
    @keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
    .tag{display:flex;align-items:center;justify-content:space-between;padding:0 14px}
    .tag .lab{font-size:9.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#cbbcff;display:inline-flex;gap:5px;align-items:center}
    .tag .lab i{width:5px;height:5px;border-radius:50%;background:#cbbcff}
    .rate{font-size:11px;font-weight:800;color:#7CFFB0;background:rgba(124,255,176,.14);padding:3px 9px;border-radius:99px}
    .creative{flex:1;min-height:0;margin:9px 14px 0;position:relative}
    .house{display:flex;gap:12px;align-items:center;height:100%}
    .house .info{flex:1;min-width:0}
    .price{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;letter-spacing:-1.4px;line-height:1;color:#e9d7fe;text-shadow:0 2px 12px rgba(130,90,255,.55);font-size:30px}
    .name{font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-top:8px;opacity:.95;font-size:11px}
    .tile{flex:none;width:92px;height:92px;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#fff,#efeaff);box-shadow:0 6px 16px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.9)}
    .tile img{width:100%;height:100%;object-fit:cover;display:block}
    .video{display:none;height:100%}
    .vthumb{position:relative;width:100%;height:100%;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#241a52,#3a2a78 60%,#1a1030);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
    .play{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-size:18px;color:#3a1d8a;background:rgba(255,255,255,.92);box-shadow:0 8px 22px rgba(0,0,0,.4);padding-left:4px}
    .vmeta{position:absolute;top:10px;left:12px;font-size:11px;color:#e7dbff;font-weight:700}
    .pp.tier-compact .price{font-size:21px}.pp.tier-compact .tile{width:62px;height:62px;border-radius:14px}.pp.tier-compact .name{font-size:9px}
    .pp.tier-large .house{display:none}.pp.tier-large .video{display:flex}
    .cta{margin:11px 14px 0;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:14px;font-weight:800;font-size:13.5px;color:#04210d;cursor:pointer;border:none;font-family:inherit;
      background:linear-gradient(150deg,#1be06a,#00C853);box-shadow:0 8px 20px rgba(0,200,83,.4),0 1px 0 rgba(255,255,255,.5) inset}
    .cta:hover{filter:brightness(1.05)}
    .foot{display:flex;align-items:center;justify-content:space-between;padding:9px 14px 12px;font-size:11px;color:#cbbcff}
    .earn{font-weight:800;color:#fff}
    .grip{position:absolute;right:4px;bottom:4px;width:16px;height:16px;cursor:nwse-resize;opacity:.6;
      background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.8) 50%) no-repeat right bottom/7px 7px,linear-gradient(135deg,transparent 50%,rgba(255,255,255,.55) 50%) no-repeat right bottom/13px 13px}
    .coin{position:absolute;left:50%;top:46px;transform:translateX(-50%);font-weight:900;font-size:15px;color:#7CFFB0;text-shadow:0 2px 8px rgba(0,0,0,.4);opacity:0;pointer-events:none}
    @keyframes coin{0%{opacity:0;transform:translate(-50%,0) scale(.5)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-46px) scale(1.1)}}
    .flash{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(8,3,24,.8);border:1px solid rgba(124,255,176,.5);color:#fff;padding:9px 15px;border-radius:12px;font-weight:800;font-size:12.5px;opacity:0;white-space:nowrap}
    .flash b{color:#7CFFB0}
    .flash.show{animation:fl 1.6s ease}
    @keyframes fl{0%{opacity:0}15%,70%{opacity:1}100%{opacity:0}}
  </style>
  <div class="pp tier-standard" id="pp">
    <div class="card">
      <div class="head" id="head"><span class="m">P</span><span class="nm">PayParty</span><span class="live"><i></i>earning</span><span class="x" id="close" title="Hide">✕</span></div>
      <div class="tag"><span class="lab"><i></i><span id="taglabel">Sponsored</span></span><span class="rate" id="rate">$0.05/min</span></div>
      <div class="creative">
        <div class="house" id="house"><div class="info"><div class="price">$249.99</div><div class="name">AirPods Pro 3</div></div>
          <div class="tile"><img id="prod" alt="Sponsored"></div></div>
        <div class="video" id="video"><div class="vthumb"><span class="vmeta">Sponsored video · 0:15</span><span class="play">▶</span></div></div>
      </div>
      <button class="cta" id="cta">View sponsor →</button>
      <div class="foot"><span class="earn" id="earn">$0.00 today</span><span>Drag corner to grow →</span></div>
      <div class="grip" id="grip" title="Bigger = higher pay"></div>
      <div class="coin" id="coin">+$0.05</div>
      <div class="flash" id="flash"></div>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const pp = $('#pp'), headEl = $('#head');
  $('#prod').src = chrome.runtime.getURL('airpods.png'); // house creative (swap for real ad)

  let state = { enabled: true, balance: 0 };
  let W = 380, H = 340, left = 0, top = 0, tier = 'standard';

  function clamp() {
    left = Math.min(Math.max(left, 8), innerWidth - W - 8);
    top = Math.min(Math.max(top, 8), innerHeight - H - 8);
    pp.style.left = left + 'px'; pp.style.top = top + 'px';
    pp.style.right = 'auto'; pp.style.bottom = 'auto';
  }
  function place() { left = innerWidth - W - 20; top = innerHeight - H - 20; pp.style.width = W + 'px'; pp.style.height = H + 'px'; clamp(); }

  function tierFor(w, h) { if (w >= 470 && h >= 380) return 'large'; if (w >= 360 && h >= 290) return 'standard'; return 'compact'; }
  function applyTier() {
    const t = tierFor(W, H);
    if (t === tier) return;
    const order = ['compact', 'standard', 'large'];
    const up = order.indexOf(t) > order.indexOf(tier);
    tier = t; pp.className = 'pp tier-' + t;
    $('#rate').textContent = '$' + RATE[t].toFixed(2) + '/min';
    $('#taglabel').textContent = t === 'large' ? 'Sponsored video' : 'Sponsored';
    if (up) flash('Bigger widget → <b>$' + RATE[t].toFixed(2) + '/min</b>');
  }
  function flash(html) { const f = $('#flash'); f.innerHTML = html; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }
  function coin(txt) { const c = $('#coin'); c.textContent = txt; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = 'coin 1.5s ease-out'; }

  /* ---- drag ---- */
  let dragging = false, sx, sy, sl, st;
  headEl.addEventListener('pointerdown', (e) => {
    if (e.target.id === 'close') return;
    dragging = true; headEl.classList.add('grabbing'); headEl.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY; sl = left; st = top; e.preventDefault();
  });
  headEl.addEventListener('pointermove', (e) => { if (!dragging) return; left = sl + (e.clientX - sx); top = st + (e.clientY - sy); clamp(); });
  headEl.addEventListener('pointerup', (e) => { dragging = false; headEl.classList.remove('grabbing'); try { headEl.releasePointerCapture(e.pointerId); } catch (x) {} saveGeom(); });

  /* ---- resize ---- */
  const grip = $('#grip'); let rz = false, rsx, rsy, rsw, rsh;
  grip.addEventListener('pointerdown', (e) => { rz = true; grip.setPointerCapture(e.pointerId); rsx = e.clientX; rsy = e.clientY; rsw = W; rsh = H; e.preventDefault(); e.stopPropagation(); });
  grip.addEventListener('pointermove', (e) => {
    if (!rz) return;
    W = Math.min(MAX.w, Math.max(MIN.w, rsw + (e.clientX - rsx)));
    H = Math.min(MAX.h, Math.max(MIN.h, rsh + (e.clientY - rsy)));
    pp.style.width = W + 'px'; pp.style.height = H + 'px';
    clamp(); applyTier();
  });
  grip.addEventListener('pointerup', (e) => { rz = false; try { grip.releasePointerCapture(e.pointerId); } catch (x) {} saveGeom(); });
  window.addEventListener('resize', clamp);

  /* ---- sponsor click (Direct Link / Smartlink) ---- */
  $('#cta').addEventListener('click', () => {
    if (ADMAVEN.smartlink) chrome.runtime.sendMessage({ type: 'pp:open', url: ADMAVEN.smartlink });
    else flash('Add your AdMaven <b>Smartlink</b> in content.js');
    addEarnings(RATE[tier] / 12 * 3); coin('+$' + (RATE[tier] / 12 * 3).toFixed(2));
  });
  $('#close').addEventListener('click', () => chrome.storage.local.set({ enabled: false }));

  /* ---- earnings (placeholder; real via AdMaven postbacks) ---- */
  function addEarnings(amt) {
    chrome.storage.local.get(['balance', 'lifetime']).then((s) => {
      const bal = Math.round(((s.balance || 0) + amt) * 100) / 100;
      chrome.storage.local.set({ balance: bal, lifetime: Math.round(((s.lifetime || 0) + amt) * 100) / 100 });
      $('#earn').textContent = '$' + bal.toFixed(2) + ' today';
    });
  }
  setInterval(() => { if (state.enabled && document.hasFocus()) addEarnings(RATE[tier] / 12); }, 5000);

  /* ---- show/hide from storage ---- */
  function refresh() {
    chrome.storage.local.get(['enabled', 'balance']).then((s) => {
      state.enabled = s.enabled !== false;
      host.style.display = state.enabled ? 'block' : 'none';
      $('#earn').textContent = '$' + ((s.balance || 0)).toFixed(2) + ' today';
    });
  }
  function saveGeom() { chrome.storage.local.set({ wx: Math.round(left), wy: Math.round(top), ww: W, wh: H, tier: tier }); }
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'pp:state') refresh(); });

  // restore saved enabled + position/size so the widget "follows" you across pages
  chrome.storage.local.get(['enabled', 'balance', 'wx', 'wy', 'ww', 'wh']).then((s) => {
    state.enabled = s.enabled !== false;
    host.style.display = state.enabled ? 'block' : 'none';
    $('#earn').textContent = '$' + ((s.balance || 0)).toFixed(2) + ' today';
    if (typeof s.ww === 'number') { W = s.ww; H = s.wh; }
    pp.style.width = W + 'px'; pp.style.height = H + 'px';
    if (typeof s.wx === 'number') { left = s.wx; top = s.wy; pp.style.left = left + 'px'; pp.style.top = top + 'px'; pp.style.right = 'auto'; pp.style.bottom = 'auto'; clamp(); }
    else { place(); }
    applyTier();
  });
})();
