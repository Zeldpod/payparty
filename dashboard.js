(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const MINIMUM = 5;
  const MAXIMUM = 5000;
  const isPreview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
    new URLSearchParams(location.search).get('preview') === '1';

  const state = {
    client: null,
    session: null,
    user: null,
    balance: 0,
    lifetime: 0,
    cashouts: [],
    earnings: [],
    requestKey: null,
    loading: false
  };

  const METHOD = {
    paypal: { name: 'PayPal', label: 'PayPal email', placeholder: 'you@example.com', type: 'email' },
    venmo: { name: 'Venmo', label: 'Venmo username', placeholder: '@yourname', type: 'text' },
    cash_app: { name: 'Cash App', label: 'Cash App $cashtag', placeholder: '$yourcashtag', type: 'text' }
  };

  const money = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(value) || 0);

  const titleCase = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const prefersReducedMotion = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Smoothly animate a money figure from its current value up to a target.
  // Purely presentational — the final displayed value is always money(target).
  const countUpState = new WeakMap();
  function animateMoney(el, target) {
    if (!el) return;
    const to = Number(target) || 0;
    const from = countUpState.has(el) ? countUpState.get(el) : 0;
    countUpState.set(el, to);
    if (prefersReducedMotion || from === to || Math.abs(to - from) < 0.005) {
      el.textContent = money(to);
      return;
    }
    const duration = 650;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = money(from + (to - from) * ease(progress));
      if (progress < 1 && countUpState.get(el) === to) requestAnimationFrame(step);
      else if (countUpState.get(el) === to) el.textContent = money(to);
    }
    requestAnimationFrame(step);
  }

  const CANONICAL = 'https://www.payparty.fun';

  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Robust redirect to the login page: strip the last path segment so it works
  // with clean URLs (/dashboard) as well as explicit files (/dashboard.html).
  function loginUrl() {
    const path = location.pathname.replace(/[^/]*$/, '');
    return location.origin + path + 'login.html';
  }
  const goToLogin = () => location.replace(loginUrl());

  function friendlyDate(value) {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + 'h ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function setAccount(user) {
    const email = user.email || '';
    const rawName = (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) || email.split('@')[0] || 'friend';
    const name = String(rawName).trim();
    $('#who').textContent = name;
    $('#avatar').textContent = (name[0] || 'F').toUpperCase();
  }

  function renderSummary() {
    animateMoney($('#balance'), state.balance);
    animateMoney($('#lifetime'), state.lifetime);
    $('#modal-available').textContent = money(state.balance);

    const percentage = Math.min(100, Math.max(0, (state.balance / MINIMUM) * 100));
    const rounded = Math.round(percentage);
    $('#cashout-progress').style.width = percentage + '%';
    $('.progress').setAttribute('aria-valuenow', String(rounded));
    $('#cashout-progress-percent').textContent = rounded + '%';
    $('#cashout-progress-label').textContent = state.balance >= MINIMUM
      ? 'Cash-out minimum reached'
      : money(state.balance) + ' of ' + money(MINIMUM) + ' minimum';
    $('#open-cashout').disabled = state.balance < MINIMUM;

    const latest = state.cashouts[0];
    if (latest) {
      $('#latest-payout').textContent = money(latest.amount) + ' · ' + (METHOD[latest.method] ? METHOD[latest.method].name : titleCase(latest.method));
      $('#latest-status').textContent = titleCase(latest.status);
      $('#latest-status').className = 'status-chip ' + latest.status;
    } else {
      $('#latest-payout').textContent = 'No requests yet';
      $('#latest-status').className = 'status-chip hidden';
    }
  }

  function renderActivity() {
    const merged = [
      ...state.earnings.map((item) => ({ ...item, kind: 'earning' })),
      ...state.cashouts.map((item) => ({ ...item, kind: 'cashout' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);

    const list = $('#activity-list');
    if (!merged.length) {
      list.innerHTML = '<div class="empty-activity">' +
        '<span class="empty-icon" aria-hidden="true">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3v18m4-14.5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</span>' +
        '<strong>No activity yet</strong>' +
        '<span class="empty-sub">Launch the widget and your first earning will show up here.</span>' +
        '</div>';
      return;
    }

    list.innerHTML = merged.map((item) => {
      if (item.kind === 'earning') {
        return '<div class="activity-row">' +
          '<span class="activity-symbol" aria-hidden="true">+</span>' +
          '<span class="activity-copy"><strong>' + escapeHtml(item.source || 'Sponsor earning') + '</strong><span>' + friendlyDate(item.created_at) + '</span></span>' +
          '<strong class="activity-amount plus">+' + money(item.amount) + '</strong></div>';
      }
      const refunded = item.status === 'failed' || item.status === 'cancelled';
      const descriptor = (METHOD[item.method] ? METHOD[item.method].name : titleCase(item.method)) + ' · ' + titleCase(item.status);
      return '<div class="activity-row cashout">' +
        '<span class="activity-symbol" aria-hidden="true">↗</span>' +
        '<span class="activity-copy"><strong>Cash-out request</strong><span>' + escapeHtml(descriptor) + ' · ' + friendlyDate(item.created_at) + '</span></span>' +
        '<strong class="activity-amount minus">' + (refunded ? 'Refunded ' : '−') + money(item.amount) + '</strong></div>';
    }).join('');
  }

  function escapeHtml(value) {
    const el = document.createElement('span');
    el.textContent = String(value || '');
    return el.innerHTML;
  }

  async function loadData(options) {
    if (state.loading) return;
    state.loading = true;
    const refreshButton = $('#refresh');
    if (options && options.spin) refreshButton.classList.add('spinning');

    if (isPreview) {
      state.balance = 38.40;
      state.lifetime = 127.85;
      state.cashouts = [
        { id: 'preview-cashout', amount: 25, method: 'venmo', status: 'paid', created_at: new Date(Date.now() - 86400000 * 2).toISOString() }
      ];
      state.earnings = [
        { id: 'preview-1', amount: .15, source: 'Sponsor video', created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
        { id: 'preview-2', amount: .05, source: 'Sponsor impression', created_at: new Date(Date.now() - 1000 * 60 * 72).toISOString() },
        { id: 'preview-3', amount: .25, source: 'Welcome bonus', created_at: new Date(Date.now() - 86400000 * 5).toISOString() }
      ];
    } else {
      const results = await Promise.all([
        state.client.from('profiles').select('balance,lifetime').eq('id', state.user.id).maybeSingle(),
        state.client.from('cashouts').select('id,amount,method,status,created_at').order('created_at', { ascending: false }).limit(8),
        state.client.from('earnings_ledger').select('id,amount,source,created_at').order('created_at', { ascending: false }).limit(8)
      ]);

      const profileResult = results[0];
      if (profileResult.error) {
        showToast('Could not load your balance. Try refreshing.');
      } else {
        state.balance = Number(profileResult.data && profileResult.data.balance) || 0;
        state.lifetime = Number(profileResult.data && profileResult.data.lifetime) || 0;
      }
      state.cashouts = results[1].error ? [] : (results[1].data || []);
      state.earnings = results[2].error ? [] : (results[2].data || []);
    }

    renderSummary();
    renderActivity();
    state.loading = false;
    refreshButton.classList.remove('spinning');
  }

  function selectedMethod() {
    const selected = document.querySelector('input[name="method"]:checked');
    return selected ? selected.value : 'paypal';
  }

  function updateMethod() {
    const method = METHOD[selectedMethod()];
    document.querySelectorAll('.method-option').forEach((option) => {
      option.classList.toggle('selected', option.querySelector('input').checked);
    });
    $('#destination-label').textContent = method.label;
    $('#cashout-destination').placeholder = method.placeholder;
    $('#cashout-destination').type = method.type;
    $('#cashout-destination').value = '';
    setFormMessage('');
  }

  function updateAmountSummary() {
    $('#cashout-summary-amount').textContent = money($('#cashout-amount').value);
  }

  function openModal() {
    if (state.balance < MINIMUM) return;
    state.requestKey = null;
    $('#cashout-form').reset();
    document.querySelector('input[name="method"][value="paypal"]').checked = true;
    updateMethod();
    $('#cashout-amount').value = Math.min(state.balance, MAXIMUM).toFixed(2);
    updateAmountSummary();
    $('#modal-available').textContent = money(state.balance);
    setFormMessage('');
    $('#cashout-modal').classList.add('open');
    $('#cashout-modal').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => $('#cashout-amount').focus(), 120);
  }

  function closeModal() {
    $('#cashout-modal').classList.remove('open');
    $('#cashout-modal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    $('#open-cashout').focus();
  }

  function setFormMessage(message, success) {
    $('#cashout-message').textContent = message || '';
    $('#cashout-message').classList.toggle('success', Boolean(success));
  }

  function validateCashout(amount, method, destination) {
    if (!Number.isFinite(amount) || amount < MINIMUM) return 'Cash-outs start at ' + money(MINIMUM) + '.';
    if (amount > Math.min(state.balance, MAXIMUM)) return 'That amount is higher than your available balance.';
    if (Math.round(amount * 100) !== amount * 100) return 'Use no more than two decimal places.';
    if (method === 'paypal' && !/^\S+@\S+\.\S+$/.test(destination)) return 'Enter a valid PayPal email.';
    if (method === 'venmo' && !/^@?[A-Za-z0-9_-]{3,30}$/.test(destination)) return 'Enter a valid Venmo username.';
    if (method === 'cash_app' && !/^\$?[A-Za-z][A-Za-z0-9_]{2,19}$/.test(destination)) return 'Enter a valid Cash App $cashtag.';
    return '';
  }

  function readableError(error) {
    const raw = String((error && error.message) || error || 'Cash-out request failed.');
    const known = [
      'Minimum cash out is $5.00', 'Maximum cash out is $5,000.00',
      'Insufficient available balance', 'Enter a valid payout destination',
      'Choose a valid payout method', 'Authentication required'
    ].find((message) => raw.includes(message));
    if (known) return known + (known.endsWith('.') ? '' : '.');
    if (/schema cache|request_cashout|cashouts/i.test(raw)) return 'Cash-outs need the latest Supabase schema before they can go live.';
    return 'We couldn’t submit that request. Your balance was not changed — please try again.';
  }

  async function submitCashout(event) {
    event.preventDefault();
    const amount = Number($('#cashout-amount').value);
    const method = selectedMethod();
    const destination = $('#cashout-destination').value.trim();
    const validation = validateCashout(amount, method, destination);
    if (validation) return setFormMessage(validation);

    const button = $('#submit-cashout');
    button.disabled = true;
    button.querySelector('span').textContent = 'Submitting…';
    setFormMessage('');

    let error = null;
    if (isPreview) {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      state.balance = Math.round((state.balance - amount) * 100) / 100;
      state.cashouts.unshift({
        id: 'preview-' + Date.now(), amount, method, status: 'pending', created_at: new Date().toISOString()
      });
    } else {
      if (!state.requestKey) state.requestKey = uuid();
      const result = await state.client.rpc('request_cashout', {
        p_amount: amount,
        p_method: method,
        p_destination: destination,
        p_request_key: state.requestKey
      });
      error = result.error;
      if (!error) await loadData();
    }

    button.disabled = false;
    button.querySelector('span').textContent = 'Request cash out';
    if (error) return setFormMessage(readableError(error));

    renderSummary();
    renderActivity();
    setFormMessage('Request received. We’ll keep the status updated here.', true);
    showToast(money(amount) + ' cash-out requested via ' + METHOD[method].name + '.');
    window.setTimeout(closeModal, 900);
  }

  async function launchWidget() {
    if (isPreview) {
      window.open(CANONICAL + '/widget?host=web', 'payparty-widget', 'width=420,height=640');
      return;
    }
    let token = state.session && state.session.access_token;
    // Prefer a freshly validated session so the widget never gets an expired token.
    if (state.client) {
      const result = await state.client.auth.getSession();
      const session = result.data && result.data.session;
      if (session) {
        state.session = session;
        token = session.access_token;
      }
    }
    if (!token) {
      showToast('Please sign in again to launch the widget.');
      return;
    }
    const url = CANONICAL + '/widget?host=web&token=' + encodeURIComponent(token);
    window.open(url, 'payparty-widget', 'width=420,height=640,menubar=no,toolbar=no,location=no');
  }

  let toastTimer;
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function bindEvents() {
    $('#logout').addEventListener('click', async () => {
      if (!isPreview && state.client) await state.client.auth.signOut();
      goToLogin();
    });
    $('#open-cashout').addEventListener('click', openModal);
    $('#close-cashout').addEventListener('click', closeModal);
    $('#cashout-modal').addEventListener('click', (event) => {
      if (event.target === $('#cashout-modal')) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('#cashout-modal').classList.contains('open')) closeModal();
    });
    document.querySelectorAll('input[name="method"]').forEach((input) => input.addEventListener('change', updateMethod));
    $('#cashout-amount').addEventListener('input', updateAmountSummary);
    $('#cashout-max').addEventListener('click', () => {
      $('#cashout-amount').value = Math.min(state.balance, MAXIMUM).toFixed(2);
      updateAmountSummary();
    });
    $('#cashout-form').addEventListener('submit', submitCashout);
    $('#refresh').addEventListener('click', () => loadData({ spin: true }));
    const launch = $('#launch-widget');
    if (launch) launch.addEventListener('click', launchWidget);
  }

  function reveal() {
    document.body.classList.remove('booting');
  }

  async function boot() {
    bindEvents();
    if (isPreview) {
      state.user = { email: 'alex@payparty.fun', user_metadata: { name: 'Alex' } };
      setAccount(state.user);
      reveal();
      await loadData();
      return;
    }

    const key = window.PAYPARTY_SUPABASE_ANON_KEY || '';
    if (!window.supabase || !window.supabase.createClient || !key || key.startsWith('PASTE_')) {
      goToLogin();
      return;
    }

    state.client = window.supabase.createClient(window.PAYPARTY_SUPABASE_URL, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const sessionResult = await state.client.auth.getSession();
    const session = sessionResult.data && sessionResult.data.session;
    if (!session) {
      goToLogin();
      return;
    }
    state.session = session;
    state.user = session.user;
    setAccount(state.user);
    reveal();
    await loadData();
  }

  boot().catch(() => {
    reveal();
    showToast('Something went wrong loading the dashboard. Refresh to try again.');
  });
})();
