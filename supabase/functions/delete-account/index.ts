// Deploy with: supabase functions deploy delete-account --project-ref <TRACKPAY_PROJECT_REF>
// The browser never receives SUPABASE_SERVICE_ROLE_KEY.
import { isAllowedOrigin, preflight } from '../_shared/cors.ts';
import { adminClient, authenticate, audit, consumeRateLimit, json, LIMITS, requestTooLarge } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight(request);
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origin is not allowed.' }, 403);
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (requestTooLarge(request, 2_000)) return json(request, { error: 'Request is too large.' }, 413);

  let user;
  let admin;
  try {
    user = await authenticate(request);
    admin = adminClient();
    const rate = await consumeRateLimit(admin, user.id, LIMITS.deleteAccount);
    if (!rate.allowed) {
      await audit(admin, user.id, LIMITS.deleteAccount.action, 'rate_limited');
      return json(request, { error: 'Too many account deletion attempts. Please wait before trying again.', retryAfterSeconds: rate.retry_after_seconds }, 429);
    }
  } catch (error) {
    return json(request, { error: error.message || 'Account deletion service is unavailable.' }, error.message === 'You must be signed in.' ? 401 : 503);
  }

  try {
    // Deleting the Auth user cascades the profile, transactions, and rate-limit
    // rows. It never affects the Google account. The minimal audit event is
    // intentionally retained for 30 days without a user foreign key.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  } catch {
    // The audit row is intentionally not populated with personal data.
    await audit(admin, user.id, LIMITS.deleteAccount.action, 'failure');
    return json(request, { error: 'Account deletion failed. Please contact support if the problem continues.' }, 500);
  }

  // Do not report a successful deletion as failed if the post-deletion audit
  // insert encounters a transient internal problem. The Auth account is gone.
  try { await audit(admin, user.id, LIMITS.deleteAccount.action, 'success'); } catch { /* service logs retain diagnostics */ }
  return json(request, { deleted: true }, 200);
});
