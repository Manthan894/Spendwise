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
    const rate = await consumeRateLimit(admin, user.id, LIMITS.clearData);
    if (!rate.allowed) {
      await audit(admin, user.id, LIMITS.clearData.action, 'rate_limited');
      return json(request, { error: 'Too many clear-data attempts. Please wait before trying again.', retryAfterSeconds: rate.retry_after_seconds }, 429);
    }
    const { error } = await admin.from('transactions').delete().eq('user_id', user.id);
    if (error) throw error;
    await audit(admin, user.id, LIMITS.clearData.action, 'success');
    return json(request, { cleared: true }, 200);
  } catch (error) {
    if (user && admin) await audit(admin, user.id, LIMITS.clearData.action, 'failure');
    return json(request, { error: error.message || 'Could not clear saved data.' }, error.message === 'You must be signed in.' ? 401 : 500);
  }
});
