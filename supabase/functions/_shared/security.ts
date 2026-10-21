import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

export const LIMITS = {
  importCommit: { action: 'commit_import', maximum: 20, windowSeconds: 3600 },
  profileSave: { action: 'profile_save', maximum: 10, windowSeconds: 600 },
  clearData: { action: 'clear_data', maximum: 5, windowSeconds: 3600 },
  deleteAccount: { action: 'delete_account', maximum: 3, windowSeconds: 3600 },
};

function environment() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Function service is not configured.');
  return { url, anonKey, serviceRoleKey };
}

export function json(request: Request, body: Record<string, unknown>, status = 200) {
  const headers = corsHeaders(request);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(headers || {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  const { url, anonKey } = environment();
  if (!authorization.startsWith('Bearer ')) throw new Error('You must be signed in.');
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) throw new Error('You must be signed in.');
  return user;
}

export function adminClient() {
  const { url, serviceRoleKey } = environment();
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function consumeRateLimit(admin: ReturnType<typeof createClient>, userId: string, limit: { action: string; maximum: number; windowSeconds: number }) {
  const { data, error } = await admin.rpc('consume_trackpay_rate_limit', {
    p_subject: userId,
    p_action: limit.action,
    p_limit: limit.maximum,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) throw new Error('Security rate limit service is unavailable.');
  return data as { allowed: boolean; retry_after_seconds: number };
}

export async function audit(admin: ReturnType<typeof createClient>, userId: string, action: string, result: string) {
  // Never include statement content, names, amounts, identifiers, PDF names, or IP addresses.
  const { error } = await admin.from('security_audit_events').insert({ user_id: userId, action, result });
  if (error) throw new Error('Security audit service is unavailable.');
  // The scheduled pg_cron job guarantees retention; this also cleans expired
  // rows promptly during normal traffic without retaining any request details.
  await admin.rpc('purge_trackpay_security_events');
}

export class RequestBodyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requestTooLarge(request: Request, maximumBytes = 1_000_000) {
  const size = Number(request.headers.get('Content-Length') || '0');
  return Number.isFinite(size) && size > maximumBytes;
}

// Enforce a byte cap while reading instead of trusting Content-Length alone.
// This also covers chunked requests with no Content-Length header.
export async function readJsonBody(request: Request, maximumBytes = 1_000_000): Promise<unknown> {
  if (requestTooLarge(request, maximumBytes)) throw new RequestBodyError('Request is too large.', 413);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RequestBodyError('Request body must be valid JSON.', 400);
  }
}
