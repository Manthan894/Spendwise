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

export function readLocalTransactions() {
  try {
    // Preserve un-synced Spendwise preview history during the TrackPay upgrade.
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

export async function saveCloudTransactions(userId, transactions) {
  if (!supabase || !transactions.length) return;
  const rows = transactions.map((transaction) => ({
    user_id: userId,
    fingerprint: buildFingerprint(transaction),
    transaction_id: transaction.transactionId || null,
    utr: transaction.utr || null,
    transaction_date: transaction.date,
    transaction_time: transaction.time || null,
    transaction_type: transaction.type,
    amount_paise: transaction.amountPaise,
    counterparty: transaction.counterparty,
    description: transaction.description || null,
    source_page: transaction.page || null,
    source_app: transaction.sourceApp || 'phonepe',
    // The original PDF and its file name are intentionally not persisted.
    source_file_name: null,
  }));
  const { error } = await supabase
    .from('transactions')
    .upsert(rows, { onConflict: 'user_id,fingerprint', ignoreDuplicates: true });
  if (error) throw error;
}

export async function deleteCloudTransactions(userId) {
  if (!supabase) return;
  const { error } = await supabase.from('transactions').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function fetchCloudProfile() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('display_name').maybeSingle();
  if (error) throw error;
  return data ? { displayName: data.display_name || '' } : null;
}

export async function saveCloudProfile(userId, displayName) {
  if (!supabase) return;
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: String(displayName || '').trim().slice(0, 60) }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function deleteCloudAccount() {
  if (!supabase) throw new Error('Account deletion is only available for a signed-in cloud account.');
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw new Error(error.message || 'The account deletion service could not be reached.');
}
