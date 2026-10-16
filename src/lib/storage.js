import { buildFingerprint } from './parser';
import { supabase } from './supabase';

const STORAGE_KEY = 'spendwise:transactions:v1';

function normalize(transaction) {
  return {
    ...transaction,
    fingerprint: buildFingerprint(transaction),
    amountPaise: Number(transaction.amountPaise),
  };
}

export function readLocalTransactions() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.map(normalize) : [];
  } catch {
    return [];
  }
}

export function writeLocalTransactions(transactions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions.map(normalize)));
}

export function mergeTransactions(current, incoming) {
  const index = new Map(current.map((transaction) => [buildFingerprint(transaction), normalize(transaction)]));
  let added = 0;
  for (const transaction of incoming) {
    const normalized = normalize(transaction);
    if (!index.has(normalized.fingerprint)) added += 1;
    index.set(normalized.fingerprint, normalized);
  }
  return {
    added,
    transactions: [...index.values()].sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`)),
  };
}

function databaseToTransaction(row) {
  return {
    fingerprint: row.fingerprint,
    transactionId: row.transaction_id,
    utr: row.utr,
    date: row.transaction_date,
    time: row.transaction_time,
    type: row.transaction_type,
    amountPaise: row.amount_paise,
    counterparty: row.counterparty,
    accountLast4: row.account_last4,
    description: row.description,
    page: row.source_page,
  };
}

export async function fetchCloudTransactions() {
  if (!supabase) return [];

  // Supabase applies a maximum row limit to a single select request. A student
  // can easily have more than that across a full year, so fetch every page
  // before building monthly, daily, or yearly summaries.
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

  return allRows.map(databaseToTransaction);
}

export async function saveCloudTransactions(userId, transactions, sourceFileName) {
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
    account_last4: transaction.accountLast4 || null,
    description: transaction.description || null,
    source_page: transaction.page || null,
    source_file_name: sourceFileName || null,
  }));
  const { error } = await supabase
    .from('transactions')
    .upsert(rows, { onConflict: 'user_id,fingerprint', ignoreDuplicates: true });
  if (error) throw error;
}

export async function deleteCloudTransactions(userId) {
  if (!supabase) return;
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

export function clearLocalTransactions() {
  localStorage.removeItem(STORAGE_KEY);
}
