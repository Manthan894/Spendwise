// Receives only user-confirmed extracted rows. The original PDF never reaches
// this function or Supabase storage.
import { isAllowedOrigin, preflight } from '../_shared/cors.ts';
import { adminClient, authenticate, audit, consumeRateLimit, json, LIMITS, readJsonBody, RequestBodyError, requestTooLarge } from '../_shared/security.ts';

const APPS = new Set(['phonepe', 'gpay', 'paytm', 'navi']);
const TYPES = new Set(['DEBIT', 'CREDIT']);
const DATE = /^\d{4}-(\d{2})-(\d{2})$/;
const TIME = /^(?:0?[1-9]|1[0-2]):[0-5]\d\s(?:AM|PM)$/;
const MAX_ROWS = 5_000;

function smallHash(input: string, prefix: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function fingerprint(transaction: Record<string, unknown>) {
  const sourceApp = String(transaction.sourceApp || 'phonepe');
  const values = {
    transactionId: String(transaction.transactionId || ''),
    utr: String(transaction.utr || ''),
    date: String(transaction.date || ''),
    time: String(transaction.time || ''),
    type: String(transaction.type || ''),
    amountPaise: Number(transaction.amountPaise || 0),
    counterparty: String(transaction.counterparty || '').toLocaleLowerCase(),
  };
  if (sourceApp === 'phonepe') {
    // Matches Spendwise's historic fingerprint shape to prevent a migration
    // from accepting a previously imported PhonePe row as new.
    return smallHash([values.transactionId, values.date, values.time, values.type, values.amountPaise, values.counterparty, values.utr].join('|'), 'pp');
  }
  return smallHash([sourceApp, values.transactionId, values.utr, values.date, values.time, values.type, values.amountPaise, values.counterparty].join('|'), 'tp');
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== 'string') return required ? null : '';
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > maximum) return null;
  return cleaned;
}

function validDate(value: string) {
  const match = value.match(DATE);
  if (!match || value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.getUTCMonth() + 1 === Number(match[1]) && date.getUTCDate() === Number(match[2]);
}

function normalize(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const sourceApp = text(item.sourceApp, 12, true)?.toLocaleLowerCase();
  const transactionType = text(item.type, 6, true)?.toUpperCase();
  const transactionDate = text(item.date, 10, true);
  const suppliedTime = item.time !== null && item.time !== undefined && item.time !== '';
  const parsedTime = suppliedTime ? text(item.time, 12, true) : null;
  const transactionTime = parsedTime?.toUpperCase() || null;
  const amountPaise = Number(item.amountPaise);
  const counterparty = text(item.counterparty, 240, true);
  const description = text(item.description, 500) || null;
  const transactionId = text(item.transactionId, 128) || null;
  const utr = text(item.utr, 128) || null;
  const sourcePage = item.page === null || item.page === undefined ? null : Number(item.page);

  if (!sourceApp || !APPS.has(sourceApp) || !transactionType || !TYPES.has(transactionType)
    || !transactionDate || !validDate(transactionDate)
    || (suppliedTime && (!transactionTime || !TIME.test(transactionTime)))
    || !Number.isSafeInteger(amountPaise) || amountPaise < 1 || amountPaise > 1_000_000_000
    || !counterparty
    || (sourcePage !== null && (!Number.isInteger(sourcePage) || sourcePage < 1 || sourcePage > 100_000))) return null;

  const transaction = { sourceApp, transactionId, utr, date: transactionDate, time: transactionTime, type: transactionType, amountPaise, counterparty, description, page: sourcePage };
  return {
    user_id: '', // set exclusively from the authenticated server-side user below
    fingerprint: fingerprint(transaction),
    transaction_id: transactionId,
    utr,
    transaction_date: transactionDate,
    transaction_time: transactionTime,
    transaction_type: transactionType,
    amount_paise: amountPaise,
    counterparty,
    description,
    source_page: sourcePage,
    source_app: sourceApp,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflight(request);
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origin is not allowed.' }, 403);
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (requestTooLarge(request)) return json(request, { error: 'Import request is too large.' }, 413);

  let user;
  let admin;
  try {
    user = await authenticate(request);
    admin = adminClient();
    const payload = await readJsonBody(request, 1_000_000) as { transactions?: unknown };
    const incoming = payload.transactions;
    if (!Array.isArray(incoming) || !incoming.length || incoming.length > MAX_ROWS) {
      return json(request, { error: `Choose between 1 and ${MAX_ROWS} transactions to save.` }, 400);
    }
    const rows = incoming.map(normalize);
    if (rows.some((row) => !row)) return json(request, { error: 'One or more transactions did not pass security validation.' }, 400);
    const unique = [...new Map(rows.map((row) => [row!.fingerprint, { ...row!, user_id: user.id }])).values()];

    const rate = await consumeRateLimit(admin, user.id, LIMITS.importCommit);
    if (!rate.allowed) {
      await audit(admin, user.id, LIMITS.importCommit.action, 'rate_limited');
      return json(request, { error: 'Too many import attempts. Please wait before trying again.', retryAfterSeconds: rate.retry_after_seconds }, 429);
    }

    const { error } = await admin.from('transactions').upsert(unique, { onConflict: 'user_id,fingerprint', ignoreDuplicates: true });
    if (error) throw error;
    await audit(admin, user.id, LIMITS.importCommit.action, 'success');
    return json(request, { accepted: unique.length }, 200);
  } catch (error) {
    if (user && admin) await audit(admin, user.id, LIMITS.importCommit.action, 'failure');
    const status = error instanceof RequestBodyError ? error.status : error.message === 'You must be signed in.' ? 401 : 500;
    return json(request, { error: error.message || 'Could not save the confirmed import.' }, status);
  }
});
