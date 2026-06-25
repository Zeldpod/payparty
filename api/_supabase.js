// PayParty — tiny Supabase REST helper for serverless functions.
// Uses native fetch (Node 20 on Vercel). The service_role key is read ONLY
// from the SUPABASE_SERVICE_ROLE env var and never leaves the server.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fcpetkipzuzbuzidvsjz.supabase.co';
// Public anon key (safe to ship; same one in supabase-config.js). Used only as
// the apikey header when validating a user token — never the service_role key.
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcGV0a2lwenV6YnV6aWR2c2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjMyMzksImV4cCI6MjA5NjQ5OTIzOX0.3BhIEcJwkjCLCZ1HgMDzXaGrmLdWcKUU54RE0wwSOvo';

function serviceRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE is not configured');
  return key;
}

// Validate a user access token by asking Supabase who it belongs to.
// Returns the user object on success, or null when the token is invalid.
export async function getUser(accessToken) {
  if (!accessToken) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

// Call a Postgres function through PostgREST with the service-role key.
export async function rpc(fn, params) {
  const key = serviceRole();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = (data && (data.message || data.error || data.hint)) || `rpc ${fn} failed`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Read rows from a table with the service-role key (bypasses RLS).
export async function select(table, query) {
  const key = serviceRole();
  const qs = query ? `?${query}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `select ${table} failed`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data || [];
}

export { SUPABASE_URL };
