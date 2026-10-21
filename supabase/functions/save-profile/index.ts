import { isAllowedOrigin, preflight } from '../_shared/cors.ts';
import { adminClient, authenticate, audit, consumeRateLimit, json, LIMITS, readJsonBody, RequestBodyError, requestTooLarge } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight(request);
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origin is not allowed.' }, 403);
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (requestTooLarge(request, 20_000)) return json(request, { error: 'Profile request is too large.' }, 413);

  let user;
  let admin;
  try {
    user = await authenticate(request);
    admin = adminClient();
    const { displayName } = await readJsonBody(request, 20_000) as { displayName?: unknown };
    if (typeof displayName !== 'string' || displayName.trim().length > 60) {
      return json(request, { error: 'Display name must be at most 60 characters.' }, 400);
    }
    const rate = await consumeRateLimit(admin, user.id, LIMITS.profileSave);
    if (!rate.allowed) {
      await audit(admin, user.id, LIMITS.profileSave.action, 'rate_limited');
      return json(request, { error: 'Too many display-name changes. Please wait before trying again.', retryAfterSeconds: rate.retry_after_seconds }, 429);
    }
    const { error } = await admin.from('profiles').upsert({ user_id: user.id, display_name: displayName.trim() }, { onConflict: 'user_id' });
    if (error) throw error;
    await audit(admin, user.id, LIMITS.profileSave.action, 'success');
    return json(request, { displayName: displayName.trim() }, 200);
  } catch (error) {
    if (user && admin) await audit(admin, user.id, LIMITS.profileSave.action, 'failure');
    const status = error instanceof RequestBodyError ? error.status : error.message === 'You must be signed in.' ? 401 : 500;
    return json(request, { error: error.message || 'Could not save display name.' }, status);
  }
});
