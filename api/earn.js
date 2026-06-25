// PayParty — EARN API (Vercel Node 20 serverless function).
//
// POST https://www.payparty.fun/api/earn
//   Header:  Authorization: Bearer <supabase access_token>
//   Body:    { "seconds": 1..60, "tier": "compact" | "standard" | "large" }
//   Returns: { balance, lifetime }  (real, post-credit values)  or  { error }
//
// The widget (Chrome extension / Electron / hosted page) posts here every 15s
// while an ad is showing. We validate the bearer token against Supabase, compute
// the payout for the elapsed seconds + tier, and credit it server-side with the
// service-role key. CORS is permissive because the widget runs cross-origin.
//
// REQUIRED VERCEL ENVIRONMENT VARIABLES (Project Settings -> Environment):
//   SUPABASE_SERVICE_ROLE   secret service_role key (server only, never shipped)
//   SUPABASE_URL            optional override; defaults to the project URL
//   SUPABASE_ANON_KEY       optional; used as the apikey when validating tokens
// (admin.html + api/payout.js additionally need ADMIN_SECRET, PAYPAL_CLIENT_ID,
//  PAYPAL_SECRET, PAYPAL_ENV — documented in api/payout.js.)

import { getUser, rpc, select } from './_supabase.js';

const RATE = { compact: 0.02, standard: 0.05, large: 0.15 };
const MAX_SECONDS = 60;
const MAX_AMOUNT = 0.20;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function bearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : '';
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing access token' }); return; }

  // Vercel parses JSON bodies automatically, but guard against string/empty.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid request body' }); return; }

  const tier = body.tier;
  if (!Object.prototype.hasOwnProperty.call(RATE, tier)) {
    res.status(400).json({ error: 'Invalid tier' });
    return;
  }

  let seconds = Number(body.seconds);
  if (!Number.isFinite(seconds) || seconds < 1) { res.status(400).json({ error: 'Invalid seconds' }); return; }
  seconds = Math.min(Math.floor(seconds), MAX_SECONDS);

  let amount = (RATE[tier] * seconds) / 60;
  amount = Math.min(amount, MAX_AMOUNT);
  amount = Math.round(amount * 100) / 100;
  if (!(amount > 0)) { res.status(400).json({ error: 'Nothing to credit' }); return; }

  const user = await getUser(token).catch(() => null);
  if (!user) { res.status(401).json({ error: 'Invalid or expired session' }); return; }

  try {
    // credit_earnings updates balance + lifetime atomically and returns the new
    // balance. Read lifetime back from the profile so the widget can show both.
    const balance = await rpc('credit_earnings', {
      p_user_id: user.id,
      p_amount: amount,
      p_source: 'Widget earnings',
    });

    let lifetime = null;
    try {
      const rows = await select('profiles', `id=eq.${user.id}&select=lifetime`);
      if (Array.isArray(rows) && rows[0]) lifetime = Number(rows[0].lifetime);
    } catch { /* lifetime is best-effort; balance is authoritative */ }

    res.status(200).json({ balance: Number(balance), lifetime });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not credit earnings' });
  }
}
