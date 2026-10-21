// Browser origins are deliberately allow-listed per Supabase project through
// the ALLOWED_ORIGINS Edge Function secret. Never use a wildcard for functions
// that can write data or delete an account.
const LOCAL_ORIGINS = new Set(['http://localhost:5173']);

function configuredOrigins() {
  return (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get('Origin')?.replace(/\/$/, '') || '';
  if (!origin) return false;
  return LOCAL_ORIGINS.has(origin) || configuredOrigins().includes(origin);
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin')?.replace(/\/$/, '') || '';
  if (!origin || !isAllowedOrigin(request)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function preflight(request: Request) {
  const headers = corsHeaders(request);
  return headers
    ? new Response('ok', { status: 200, headers })
    : new Response(JSON.stringify({ error: 'Origin is not allowed.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}
