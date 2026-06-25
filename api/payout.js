// PayParty — PAYOUT API (Vercel Node 20 serverless function). ADMIN ONLY.
//
// POST https://www.payparty.fun/api/payout
//   Header:  x-admin-secret: <ADMIN_SECRET>   (required for every action)
//   Body:
//     { "action": "list" }
//         -> { cashouts: [ pending rows ] }
//     { "action": "pay", "id": <cashout uuid> }
//         -> PayPal Payouts for method "paypal"; resolves processing -> paid.
//         -> For venmo / cash_app this is manual; returns { manual: true }.
//     { "action": "mark_paid", "id": <uuid>, "reference": <text> }
//         -> resolve_cashout(id, "paid", reference)   (manual methods)
//     { "action": "fail", "id": <uuid> }
//         -> resolve_cashout(id, "failed")  (refunds the user automatically)
//
// REQUIRED VERCEL ENVIRONMENT VARIABLES:
//   ADMIN_SECRET            shared secret the operator types into admin.html
//   SUPABASE_SERVICE_ROLE   service_role key (server only)
//   PAYPAL_CLIENT_ID        PayPal REST app client id
//   PAYPAL_SECRET           PayPal REST app secret
//   PAYPAL_ENV              "live" | "sandbox"  (defaults to sandbox)
// Service-role and PayPal credentials are NEVER included in any response.

import { rpc, select } from './_supabase.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-secret, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function paypalBase() {
  return (process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function paypalToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error('PayPal is not configured');
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    throw new Error('Could not authenticate with PayPal');
  }
  return data.access_token;
}

async function paypalPayout(token, cashout) {
  const res = await fetch(`${paypalBase()}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: `payparty-${cashout.id}`,
        email_subject: 'You have a PayParty payout',
        email_message: 'Thanks for partying with PayParty — here is your cash out.',
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: Number(cashout.amount).toFixed(2), currency: 'USD' },
        receiver: cashout.destination,
        note: 'PayParty earnings payout',
        sender_item_id: cashout.id,
      }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.batch_header) {
    const detail = (data && (data.message || data.name)) || 'PayPal payout failed';
    const err = new Error(detail);
    err.paypal = true;
    throw err;
  }
  return data.batch_header.payout_batch_id;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const expected = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'];
  if (!expected || !provided || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid request body' }); return; }

  const action = body.action;

  try {
    if (action === 'list') {
      const rows = await select(
        'cashouts',
        'status=eq.pending&select=id,user_id,amount,method,destination,status,created_at&order=created_at.asc'
      );
      res.status(200).json({ cashouts: rows });
      return;
    }

    if (action === 'mark_paid') {
      if (!body.id) { res.status(400).json({ error: 'Missing cash-out id' }); return; }
      const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
      if (!reference) { res.status(400).json({ error: 'A payout reference is required' }); return; }
      // resolve_cashout forbids a direct pending->paid jump, so reserve the row
      // as processing first (mirrors the PayPal path), then mark it paid.
      await rpc('resolve_cashout', { p_cashout_id: body.id, p_status: 'processing' });
      await rpc('resolve_cashout', { p_cashout_id: body.id, p_status: 'paid', p_reference: reference });
      res.status(200).json({ status: 'paid', id: body.id, reference });
      return;
    }

    if (action === 'fail') {
      if (!body.id) { res.status(400).json({ error: 'Missing cash-out id' }); return; }
      await rpc('resolve_cashout', { p_cashout_id: body.id, p_status: 'failed' });
      res.status(200).json({ status: 'failed', id: body.id });
      return;
    }

    if (action === 'pay') {
      if (!body.id) { res.status(400).json({ error: 'Missing cash-out id' }); return; }

      const rows = await select(
        'cashouts',
        `id=eq.${body.id}&select=id,user_id,amount,method,destination,status`
      );
      const cashout = Array.isArray(rows) ? rows[0] : null;
      if (!cashout) { res.status(404).json({ error: 'Cash-out not found' }); return; }
      if (cashout.status !== 'pending') {
        res.status(409).json({ error: `Cash-out is already ${cashout.status}` });
        return;
      }

      // Venmo + Cash App have no payout API here — they are paid by hand and
      // confirmed through the mark_paid action.
      if (cashout.method !== 'paypal') {
        res.status(200).json({ manual: true, method: cashout.method, id: cashout.id });
        return;
      }

      // Reserve the row as processing first so a retry can't double-pay.
      await rpc('resolve_cashout', { p_cashout_id: cashout.id, p_status: 'processing' });

      let batchId;
      try {
        const token = await paypalToken();
        batchId = await paypalPayout(token, cashout);
      } catch (err) {
        // PayPal rejected the transfer — refund the user by failing the row.
        await rpc('resolve_cashout', { p_cashout_id: cashout.id, p_status: 'failed' }).catch(() => {});
        res.status(502).json({ error: err.message || 'PayPal payout failed' });
        return;
      }

      await rpc('resolve_cashout', { p_cashout_id: cashout.id, p_status: 'paid', p_reference: batchId });
      res.status(200).json({ status: 'paid', id: cashout.id, reference: batchId });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Payout operation failed' });
  }
}
