'use strict';
/* ============================================================
   PayParty extension — Supabase auth (direct REST, NO SDK)
   ------------------------------------------------------------
   Shared by popup.js and dashboard.js. Authenticates against
   Supabase Auth with email/password, stores the session in
   chrome.storage.local under "session", refreshes the access
   token when expired, and reads the REAL balance from the
   profiles table (RLS: a user can only read their own row).
   Only the PUBLIC anon key is used here — never service_role.
   ============================================================ */
(function () {
  var SUPABASE_URL = 'https://fcpetkipzuzbuzidvsjz.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcGV0a2lwenV6YnV6aWR2c2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjMyMzksImV4cCI6MjA5NjQ5OTIzOX0.3BhIEcJwkjCLCZ1HgMDzXaGrmLdWcKUU54RE0wwSOvo';
  var WEB_LOGIN = 'https://www.payparty.fun/login';

  function authHeaders() {
    return { apikey: ANON_KEY, 'Content-Type': 'application/json' };
  }

  // shape the session we persist from a Supabase auth response
  function toSession(j) {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      // expires_at (epoch seconds) is the source of truth; fall back to expires_in
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      user: j.user || null
    };
  }

  function getSession() {
    return chrome.storage.local.get('session').then(function (s) { return s.session || null; });
  }
  function setSession(sess) {
    return chrome.storage.local.set({ session: sess }).then(function () { return sess; });
  }
  function clearSession() {
    return chrome.storage.local.remove(['session', 'balance', 'lifetime']);
  }

  // POST /auth/v1/token?grant_type=password
  function signIn(email, password) {
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ email: email, password: password })
    }).then(parseAuth).then(function (j) { return setSession(toSession(j)); });
  }

  // POST /auth/v1/signup  (may return a session immediately, or require email confirm)
  function signUp(email, password) {
    return fetch(SUPABASE_URL + '/auth/v1/signup', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ email: email, password: password })
    }).then(parseAuth).then(function (j) {
      if (j.access_token) return setSession(toSession(j));
      // confirmation-required flow: no token yet
      return { needsConfirm: true, user: j.user || j };
    });
  }

  // POST /auth/v1/token?grant_type=refresh_token
  function refresh(refreshToken) {
    return fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken })
    }).then(parseAuth).then(function (j) { return setSession(toSession(j)); });
  }

  function parseAuth(res) {
    return res.json().then(function (j) {
      if (!res.ok) {
        var msg = j.error_description || j.msg || j.error || j.message || ('Auth failed (' + res.status + ')');
        throw new Error(msg);
      }
      return j;
    });
  }

  // Return a valid access token, refreshing (and re-persisting) if it has expired
  // or is within 60s of expiry. Resolves null if there is no usable session.
  function getValidToken() {
    return getSession().then(function (sess) {
      if (!sess || !sess.access_token) return null;
      var now = Math.floor(Date.now() / 1000);
      if (sess.expires_at && sess.expires_at - 60 > now) return sess.access_token;
      if (!sess.refresh_token) return sess.access_token; // best effort
      return refresh(sess.refresh_token).then(function (fresh) {
        return fresh.access_token;
      }, function () {
        return clearSession().then(function () { return null; });
      });
    });
  }

  // Read the REAL balance/lifetime from profiles (RLS-scoped to the user).
  // Mirrors into chrome.storage.local so the popup/dashboard UI stays in sync.
  function fetchBalance() {
    return getSession().then(function (sess) {
      if (!sess || !sess.user || !sess.user.id) return null;
      return getValidToken().then(function (token) {
        if (!token) return null;
        var url = SUPABASE_URL + '/rest/v1/profiles?id=eq.' +
          encodeURIComponent(sess.user.id) + '&select=balance,lifetime';
        return fetch(url, {
          headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
        }).then(function (res) {
          if (!res.ok) return null;
          return res.json();
        }).then(function (rows) {
          if (!rows || !rows.length) return null;
          var bal = Number(rows[0].balance) || 0;
          var life = Number(rows[0].lifetime) || 0;
          chrome.storage.local.set({ balance: bal, lifetime: life });
          return { balance: bal, lifetime: life };
        });
      });
    }).catch(function () { return null; });
  }

  function signOut() { return clearSession(); }

  window.PPAuth = {
    SUPABASE_URL: SUPABASE_URL,
    ANON_KEY: ANON_KEY,
    WEB_LOGIN: WEB_LOGIN,
    getSession: getSession,
    signIn: signIn,
    signUp: signUp,
    refresh: refresh,
    getValidToken: getValidToken,
    fetchBalance: fetchBalance,
    signOut: signOut
  };
})();
