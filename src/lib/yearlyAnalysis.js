const MONTHS_PER_YEAR = 12;

function cleanMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(value || '') ? value : null;
}

export function transactionMonthKey(transaction) {
  return cleanMonthKey(transaction?.date?.slice(0, 7));
}

function partsFromMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

export function addMonths(monthKey, amount) {
  const { year, month } = partsFromMonthKey(monthKey);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsInRange(startMonth, length = MONTHS_PER_YEAR) {
  return Array.from({ length }, (_item, index) => addMonths(startMonth, index));
}

export function formatAnalysisMonth(monthKey, options = { month: 'short', year: 'numeric' }) {
  const { year, month } = partsFromMonthKey(monthKey);
  return new Intl.DateTimeFormat('en-IN', options).format(new Date(year, month - 1, 1));
}

function calendarYearLabel(startMonth, endMonth) {
  const { year: startYear, month: startNumber } = partsFromMonthKey(startMonth);
  const { year: endYear, month: endNumber } = partsFromMonthKey(endMonth);

  if (startNumber === 1 && endNumber === 12 && startYear === endYear) {
    return { label: `Calendar Year ${startYear}`, kind: 'Calendar year' };
  }

  if (startNumber === 4 && endNumber === 3 && endYear === startYear + 1) {
    return { label: `Financial Year ${startYear}–${String(endYear).slice(-2)}`, kind: 'Indian financial year' };
  }

  return {
    label: `${formatAnalysisMonth(startMonth)} – ${formatAnalysisMonth(endMonth)}`,
    kind: 'Continuous 12-month period',
  };
}

function getConsecutiveRuns(monthKeys) {
  if (!monthKeys.length) return [];
  const runs = [];
  let runStart = monthKeys[0];
  let previous = monthKeys[0];

  for (const current of monthKeys.slice(1)) {
    if (current === addMonths(previous, 1)) {
      previous = current;
      continue;
    }
    runs.push({ startMonth: runStart, endMonth: previous, length: monthsInRange(runStart, 1 + monthDistance(runStart, previous)).length });
    runStart = current;
    previous = current;
  }
  runs.push({ startMonth: runStart, endMonth: previous, length: monthsInRange(runStart, 1 + monthDistance(runStart, previous)).length });
  return runs;
}

function monthDistance(startMonth, endMonth) {
  const start = partsFromMonthKey(startMonth);
  const end = partsFromMonthKey(endMonth);
  return (end.year - start.year) * 12 + (end.month - start.month);
}

/**
 * Finds every complete continuous 12-month period based on months that contain
 * at least one imported transaction. The app intentionally does not guess that
 * a missing month was covered by a statement with no activity.
 */
export function getYearlyEligibility(transactions) {
  const presentMonths = [...new Set(transactions.map(transactionMonthKey).filter(Boolean))].sort();
  const runs = getConsecutiveRuns(presentMonths);
  const longestRun = runs.reduce((longest, run) => (!longest || run.length > longest.length ? run : longest), null);
  const periodMap = new Map();

  for (const run of runs) {
    if (run.length < MONTHS_PER_YEAR) continue;
    for (let offset = 0; offset <= run.length - MONTHS_PER_YEAR; offset += 1) {
      const startMonth = addMonths(run.startMonth, offset);
      const endMonth = addMonths(startMonth, MONTHS_PER_YEAR - 1);
      const display = calendarYearLabel(startMonth, endMonth);
      const id = `${startMonth}:${endMonth}`;
      periodMap.set(id, { id, startMonth, endMonth, ...display });
    }
  }

  const periods = [...periodMap.values()].sort((a, b) => b.endMonth.localeCompare(a.endMonth) || b.startMonth.localeCompare(a.startMonth));
  const longestLength = longestRun?.length || 0;

  return {
    eligible: periods.length > 0,
    periods,
    presentMonths,
    longestRun,
    longestLength,
    monthsNeeded: Math.max(0, MONTHS_PER_YEAR - longestLength),
  };
}

export function transactionsForYearlyPeriod(transactions, period) {
  if (!period) return [];
  return transactions.filter((transaction) => {
    const key = transactionMonthKey(transaction);
    return key && key >= period.startMonth && key <= period.endMonth;
  });
}

/** Groups exact statement names and ranks by all activity (debits + credits). */
export function rankYearlyCounterparties(transactions) {
  const groups = new Map();

  for (const transaction of transactions) {
    const name = transaction.counterparty?.trim() || 'Unknown counterparty';
    const key = name.toLocaleLowerCase();
    const group = groups.get(key) || {
      key,
      name,
      count: 0,
      paid: 0,
      received: 0,
      transactions: [],
    };

    group.count += 1;
    if (transaction.type === 'DEBIT') group.paid += Number(transaction.amountPaise || 0);
    else if (transaction.type === 'CREDIT') group.received += Number(transaction.amountPaise || 0);
    group.transactions.push(transaction);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count || (b.paid + b.received) - (a.paid + a.received) || a.name.localeCompare(b.name))
    .map((group, index) => ({ ...group, rank: index + 1 }));
}

export function yearlyTotals(transactions) {
  return transactions.reduce((totals, transaction) => {
    totals.count += 1;
    if (transaction.type === 'DEBIT') totals.paid += Number(transaction.amountPaise || 0);
    if (transaction.type === 'CREDIT') totals.received += Number(transaction.amountPaise || 0);
    return totals;
  }, { count: 0, paid: 0, received: 0 });
}
