// PayParty — WAITLIST API (Vercel Node 20 serverless function).
//
// POST https://www.payparty.fun/api/waitlist
//   Body:    { "email": "you@example.com", "source"?: "landing" }
//   Returns: { ok: true, count: <total signups> }
//   Inserting an email that is already on the list is NOT an error (idempotent).
//
// GET  https://www.payparty.fun/api/waitlist
//   Returns: { count: <total signups> }
//
// The landing form, the hero widget, and the Chrome extension may all call this
// cross-origin, so CORS is permissive (mirrors api/earn.js). Rows are written
// with the service-role key only — there are no client RLS policies on the
// public.waitlist table (see supabase/schema.sql).
//
// REQUIRED VERCEL ENVIRONMENT VARIABLES (Project Settings -> Environment):
//   SUPABASE_SERVICE_ROLE   secret service_role key (server only, already set)
//   SUPABASE_URL            optional override; defaults to the project URL
// (No anon key needed here — every request uses the service-role key.)

import { SUPABASE_URL } from './_supabase.js';

// Pragmatic RFC-5322-ish email check: something@something.tld, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 maximum
const MAX_SOURCE_LEN = 80;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Insert a waitlist row with the service-role key. We let PostgREST resolve the
// unique-email conflict server-side (on_conflict + ignore-duplicates) so a
// duplicate signup succeeds quietly instead of erroring.
async function insertWaitlist(email, source) {
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE is not configured');

  const url = `${SUPABASE_URL}/rest/v1/waitlist?on_conflict=email`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Idempotent: skip rows whose email already exists, do not return them.
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify([{ email, source: source || null }]),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const message = (data && (data.message || data.error || data.hint)) || 'Could not join the waitlist';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
}

// Total number of signups via PostgREST's EXACT count — reads the Content-Range
// header, so it never caps at the default max-rows and transfers zero rows.
async function waitlistCount() {
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!key) return 0;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist?select=id`, {
    method: 'HEAD',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  const total = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method === 'GET') {
    try {
      const count = await waitlistCount();
      res.status(200).json({ count });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not read the waitlist' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Vercel parses JSON bodies automatically, but guard against string/empty.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }

  let source = body.source == null ? null : String(body.source).trim().slice(0, MAX_SOURCE_LEN);
  if (source === '') source = null;

  try {
    await insertWaitlist(email, source);
    let count = 0;
    try { count = await waitlistCount(); } catch { /* count is best-effort */ }
    res.status(200).json({ ok: true, count });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not join the waitlist' });
  }
}
