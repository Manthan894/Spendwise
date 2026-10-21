import { buildFingerprint } from './parser';
import { supabase } from './supabase';

const STORAGE_KEY = 'trackpay:transactions:v1';
const LEGACY_STORAGE_KEY = 'spendwise:transactions:v1';
const PROFILE_STORAGE_KEY = 'trackpay:profile:v1';

function normalize(transaction) {
  const sourceApp = transaction.sourceApp || transaction.source_app || 'phonepe';
  return {
    ...transaction,
    sourceApp,
    fingerprint: buildFingerprint({ ...transaction, sourceApp }),
    amountPaise: Number(transaction.amountPaise),
  };
}

function newestFirst(a, b) {
  return `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`);
}

async function functionError(error) {
  // Supabase FunctionsHttpError keeps the API response on context. Surface a
  // safe server-provided message while never exposing internal stack traces.
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const body = await response.clone().json();
      if (typeof body?.error === 'string') return body.error;
    }
  } catch {
    // Fall back to the generic client error below.
  }
  return error?.message || 'The protected TrackPay service could not be reached.';
}

async function invokeProtectedFunction(name, body = {}) {
  if (!supabase) throw new Error('TrackPay cloud services are not configured.');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await functionError(error));
  return data;
}

export function readLocalTransactions() {
  try {
    const active = localStorage.getItem(STORAGE_KEY);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    const stored = JSON.parse(active || legacy || '[]');
    return Array.isArray(stored) ? stored.map(normalize).sort(newestFirst) : [];
  } catch {
    return [];
  }
}

export function writeLocalTransactions(transactions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions.map(normalize)));
}

export function clearLocalTransactions() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function readLocalProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
    return profile && typeof profile === 'object' ? profile : {};
  } catch {
    return {};
  }
}

export function writeLocalProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
    displayName: String(profile.displayName || '').trim().slice(0, 60),
  }));
}

export function mergeTransactions(current, incoming) {
  const index = new Map(current.map((transaction) => {
    const normalized = normalize(transaction);
    return [normalized.fingerprint, normalized];
  }));
  let added = 0;
  for (const transaction of incoming) {
    const normalized = normalize(transaction);
    if (!index.has(normalized.fingerprint)) added += 1;
    index.set(normalized.fingerprint, normalized);
  }
  return { added, transactions: [...index.values()].sort(newestFirst) };
}

function databaseToTransaction(row) {
  return normalize({
    fingerprint: row.fingerprint,
    transactionId: row.transaction_id,
    utr: row.utr,
    date: row.transaction_date,
    time: row.transaction_time,
    type: row.transaction_type,
    amountPaise: row.amount_paise,
    counterparty: row.counterparty,
    description: row.description,
    page: row.source_page,
    sourceApp: row.source_app || 'phonepe',
  });
}

export async function fetchCloudTransactions() {
  if (!supabase) return [];
  const pageSize = 1000;
  const allRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return allRows.map(databaseToTransaction).sort(newestFirst);
}

// Mutating cloud actions are intentionally functions, not direct client writes.
// The functions derive the user ID from the JWT, validate payloads, apply rate
// limits, and write privacy-safe audit events.
export async function saveCloudTransactions(transactions) {
  if (!transactions.length) return { accepted: 0 };
  return invokeProtectedFunction('commit-import', { transactions: transactions.map(normalize) });
}

export async function deleteCloudTransactions() {
  return invokeProtectedFunction('clear-data');
}

export async function fetchCloudProfile() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('display_name').maybeSingle();
  if (error) throw error;
  return data ? { displayName: data.display_name || '' } : null;
}

export async function saveCloudProfile(displayName) {
  return invokeProtectedFunction('save-profile', { displayName: String(displayName || '').trim().slice(0, 60) });
}

export async function deleteCloudAccount() {
  return invokeProtectedFunction('delete-account');
}
