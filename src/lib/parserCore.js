// Pure, browser-safe statement parsing helpers. They operate only on text that
// PDF.js has already extracted locally from the uploaded PDF.

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export const SUPPORTED_SOURCE_APPS = ['phonepe', 'gpay', 'paytm', 'navi'];

export const SOURCE_APP_LABELS = {
  phonepe: 'PhonePe',
  gpay: 'GPay',
  paytm: 'Paytm',
  navi: 'Navi',
};

export function cleanText(value = '') {
  return String(value).replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sourceAppLabel(value) {
  return SOURCE_APP_LABELS[value] || 'Unknown app';
}

export function smallHash(input) {
  // Deterministic browser-only hash used only for duplicate prevention.
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `tp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function legacyPhonePeHash(transaction) {
  let hash = 2166136261;
  const input = [
    transaction.transactionId || '', transaction.date, transaction.time || '', transaction.type,
    transaction.amountPaise, transaction.counterparty?.toLowerCase() || '', transaction.utr || '',
  ].join('|');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildFingerprint(transaction) {
  if (transaction.fingerprint) return transaction.fingerprint;
  const sourceApp = transaction.sourceApp || 'phonepe';
  // Existing Spendwise PhonePe rows used this shape. Keeping it prevents a
  // TrackPay upgrade from importing the same historic PhonePe row twice.
  if (sourceApp === 'phonepe') return legacyPhonePeHash(transaction);
  return smallHash([
    sourceApp,
    transaction.transactionId || '',
    transaction.utr || '',
    transaction.date,
    transaction.time || '',
    transaction.type,
    transaction.amountPaise,
    transaction.counterparty?.toLocaleLowerCase() || '',
  ].join('|'));
}

export function textItemsToLines(items) {
  const positioned = items
    .filter((item) => cleanText(item.str))
    .map((item) => ({ text: cleanText(item.str), x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.75);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .map(cleanText)
    .filter(Boolean);
}

export function detectStatementSource(pages) {
  const text = cleanText(pages.flatMap((page) => page.lines || []).join(' ')).toLocaleLowerCase();
  const markers = {
    phonepe: [
      ['phonepe', 4], ['utr no', 2], ['transaction id', 1], ['phonepe statement', 4],
    ],
    gpay: [
      ['google pay', 4], ['transaction statement', 3], ['upi transaction id', 3], ['paid by', 1],
    ],
    paytm: [
      ['paytm statement', 5], ['passbook payments history', 4], ['upi ref no', 3], ['total money paid', 2],
    ],
    navi: [
      ['via navi', 4], ['navi upi', 4], ['done via navi', 4], ['upi txn id', 2],
    ],
  };

  const scored = SUPPORTED_SOURCE_APPS.map((app) => ({
    app,
    score: markers[app].reduce((total, [marker, points]) => total + (text.includes(marker) ? points : 0), 0),
  })).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const runnerUp = scored[1];
  const confident = winner.score >= 5 && winner.score >= runnerUp.score + 2;
  return {
    app: winner.score ? winner.app : null,
    confident,
    scores: Object.fromEntries(scored.map(({ app, score }) => [app, score])),
  };
}

function parseAmount(value) {
  if (!value) return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function parseYear(value) {
  if (!value) return null;
  const parsed = Number(String(value).replace(/'/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return parsed < 100 ? 2000 + parsed : parsed;
}

function isoDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateToken(token) {
  const text = cleanText(token);
  let result = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*'?([0-9]{2,4})$/i);
  if (result) {
    const month = MONTHS[result[2].toLocaleLowerCase()];
    const year = parseYear(result[3]);
    return month === undefined || !year ? null : isoDate(year, month, Number(result[1]));
  }
  result = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*'?([0-9]{2,4})$/i);
  if (result) {
    const month = MONTHS[result[1].toLocaleLowerCase()];
    const year = parseYear(result[3]);
    return month === undefined || !year ? null : isoDate(year, month, Number(result[2]));
  }
  return null;
}

function dateTokensWithPositions(text) {
  const expression = /(?:\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*'?\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*'?\d{2,4})/g;
  return [...text.matchAll(expression)]
    .map((match) => ({ index: match.index || 0, end: (match.index || 0) + match[0].length, value: parseDateToken(match[0]) }))
    .filter((token) => token.value);
}

export function parseStatementPeriod(text) {
  const tokens = dateTokensWithPositions(text);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const first = tokens[index];
    const second = tokens[index + 1];
    const between = text.slice(first.end, second.index);
    if (/^\s*(?:to|\-|–|—)\s*$/i.test(between)) {
      return { start: first.value, end: second.value };
    }
  }
  return null;
}

function isDateStart(line) {
  const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  return new RegExp(`^(?:\\d{1,2}\\s+${month}(?:\\s*,?\\s*'?\\d{2,4})?|${month}\\s+\\d{1,2},?\\s*'?\\d{4})\\b`, 'i').test(line);
}

function isRepeatedStatementChrome(line) {
  return /^(?:Transaction statement$|Transaction statement period\b|Paytm Statement for\b|Passbook Payments History$|All payments done by you\b|Date\s*&?$|Date\s*&?\s*Time\b|Date & time\b|Time$|Transaction Details\b|Note: This statement reflects\b|Page\s+\d+\s+of\s+\d+\b)/i.test(line);
}

function isStatementPeriodDateLine(line) {
  return /^\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*'?\d{2,4}\s*(?:to|\-|–|—)\s*\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*'?\d{2,4}\b/i.test(line);
}

function blocksFromLines(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    // PDF headers and footers can occur between the last row of one page and
    // the next page. Never append them to a transaction block: GPay's footer
    // mentions "Self transfer" and would otherwise misclassify normal rows.
    if (isRepeatedStatementChrome(line) || isStatementPeriodDateLine(line)) continue;
    if (isDateStart(line)) {
      if (current?.length) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current?.length) blocks.push(current);
  return blocks;
}

function parseShortDate(text, period) {
  const match = cleanText(text).match(/^(\d{1,2})\s+([A-Za-z]{3,9})\b/i);
  if (!match || !period) return null;
  const month = MONTHS[match[2].toLocaleLowerCase()];
  if (month === undefined) return null;
  const day = Number(match[1]);
  const [startYear, endYear] = [Number(period.start.slice(0, 4)), Number(period.end.slice(0, 4))];
  const candidates = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const candidate = isoDate(year, month, day);
    if (candidate && candidate >= period.start && candidate <= period.end) candidates.push(candidate);
  }
  if (candidates.length === 1) return { date: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { date: candidates[candidates.length - 1], ambiguous: true };
  return null;
}

function parseDateFromBlock(block, period) {
  const firstLine = cleanText(block[0]);
  const fullMatch = firstLine.match(/^(\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*'?\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*'?\d{4})\b/i);
  if (fullMatch) return { date: parseDateToken(fullMatch[1]), ambiguous: false };
  return parseShortDate(firstLine, period);
}

function firstAmount(text) {
  const signed = [...text.matchAll(/([+-])\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
  if (signed.length) {
    const match = signed[signed.length - 1];
    return { amountPaise: parseAmount(match[2]), sign: match[1] };
  }
  const plain = [...text.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
  if (!plain.length) return { amountPaise: null, sign: null };
  return { amountPaise: parseAmount(plain[plain.length - 1][1]), sign: null };
}

function readType(text, sign) {
  if (/\b(?:received from|money received|credited|credit)\b/i.test(text)) return 'CREDIT';
  if (/\b(?:paid to|money sent to|payment to|transfer to|debit)\b/i.test(text)) return 'DEBIT';
  if (sign === '+') return 'CREDIT';
  if (sign === '-') return 'DEBIT';
  return null;
}

function cleanCounterparty(value) {
  return cleanText(value)
    .replace(/\b(?:on|via)\s*$/i, '')
    .replace(/\s+Tag:\s*$/i, '')
    .replace(/[|•]+/g, ' ')
    .trim();
}

function counterpartyFromAction(text) {
  const match = text.match(/\b(?:Paid to|Received from|Money sent to|Transfer to|Transfer from|Payment to)\s+(.+?)(?=\s+(?:UPI\s*(?:Transaction|txn)\s*ID|UPI\s*Ref\s*No|Transaction\s*ID|UTR\s*(?:No\.)?|Note:|Tag:|India\s+Post|Other\s+UPI|Paid\s+(?:by|to)|₹|Rs\.?|INR)|$)/i);
  return match?.[1] ? cleanCounterparty(match[1]) : null;
}

function counterpartyFromUntitledCredit(text) {
  // Paytm's received-money rows can begin directly with the sender's name.
  let candidate = text
    .replace(/^(?:\d{1,2}\s+[A-Za-z]{3,9}(?:\s*,?\s*'?\d{2,4})?\s*)/i, '')
    .replace(/^(?:[A-Za-z]{3,9}\s+\d{1,2},?\s*'?\d{4}\s*)/i, '')
    .replace(/^\d{1,2}:\d{2}\s*[AP]M\s*/i, '');
  candidate = candidate.split(/\s+(?:UPI\s*ID|UPI\s*Ref\s*No|Transaction\s*ID|UTR\s*(?:No\.)?|Note:|Tag:|India\s+Post|Other\s+UPI|₹|Rs\.?|INR)\b/i)[0];
  candidate = candidate.replace(/\b(?:Money Received|Credit)\b/ig, '');
  return cleanCounterparty(candidate);
}

function recordIdentifier(text) {
  return text.match(/\bUPI\s+(?:Transaction|txn)\s*ID\s*[:.]?\s*([A-Za-z0-9-]{6,})/i)?.[1]
    || text.match(/\bUPI\s*Ref\s*No\s*[:.]?\s*([A-Za-z0-9-]{6,})/i)?.[1]
    || text.match(/\bTransaction\s*ID\s*[:.]?\s*([A-Za-z0-9-]{6,})/i)?.[1]
    || null;
}

function recordUtr(text) {
  return text.match(/\bUTR\s*(?:No\.)?\s*[:.]?\s*([A-Za-z0-9-]{6,})/i)?.[1] || null;
}

function specialReason(text) {
  const rules = [
    ['refund', /\brefund(?:ed)?\b/i],
    ['reversal', /\b(?:reversal|reversed)\b/i],
    ['cashback', /\bcash\s*back\b/i],
    ['self transfer', /\bself\s*-?\s*transfer\b/i],
    ['failed payment', /\b(?:failed|declined|cancelled)\b/i],
    ['pending payment', /\bpending\b/i],
  ];
  return rules.find(([, expression]) => expression.test(text))?.[0] || null;
}

function parseBlock(block, page, sourceApp, period) {
  const text = cleanText(block.join(' '));
  const dateResult = parseDateFromBlock(block, period);
  const { amountPaise, sign } = firstAmount(text);
  const type = readType(text, sign);
  const ignoredReason = specialReason(text);
  const hasPaymentClue = /\b(?:paid to|received from|money sent to|money received|upi\s*(?:transaction|txn)?\s*id|upi\s*ref\s*no|transaction\s*id|utr\b)/i.test(text);

  if (ignoredReason && dateResult?.date && amountPaise !== null) {
    return { kind: 'skipped', reason: ignoredReason, page, text };
  }
  if (!dateResult?.date || amountPaise === null || !type || !hasPaymentClue) {
    return hasPaymentClue || amountPaise !== null ? { kind: 'unreadable', page, text } : { kind: 'ignore' };
  }

  const actionCounterparty = counterpartyFromAction(text);
  const counterparty = actionCounterparty || counterpartyFromUntitledCredit(text) || 'Unknown counterparty';
  const transactionId = recordIdentifier(text);
  const utr = recordUtr(text);
  const action = type === 'CREDIT' ? 'Received from' : 'Paid to';
  const transaction = {
    sourceApp,
    transactionId,
    utr,
    date: dateResult.date,
    time: text.match(/\b(\d{1,2}:\d{2}\s*[AP]M)\b/i)?.[1]?.toUpperCase().replace(/\s+/g, ' ') || null,
    type,
    amountPaise,
    counterparty,
    description: `${action} ${counterparty}`,
    page,
  };
  transaction.fingerprint = buildFingerprint(transaction);
  return { kind: 'transaction', transaction, ambiguousDate: dateResult.ambiguous };
}

function declaredSummary(app, text) {
  if (app === 'gpay') {
    // In the PDF text layer, labels and amounts are often different positioned
    // items, e.g. "Sent Received 01 Sep … ₹10 ₹5".
    const summaryWindow = text.match(/\bSent\b([\s\S]{0,160}?)\bDate\s*&?\s*time\b/i)?.[1] || '';
    const values = [...summaryWindow.matchAll(/₹\s*([\d,]+(?:\.\d{1,2})?)/g)].map((match) => match[1]);
    return { paidPaise: parseAmount(values[0]), receivedPaise: parseAmount(values[1]) };
  }
  if (app === 'paytm') {
    // The two label columns precede both signed figures in Paytm's PDF table.
    const summaryWindow = text.match(/Paytm\s+Statement\s+for([\s\S]{0,220}?)\bNote:/i)?.[1] || '';
    const paid = summaryWindow.match(/-\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    const received = summaryWindow.match(/\+\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    return { paidPaise: parseAmount(paid), receivedPaise: parseAmount(received) };
  }
  return { paidPaise: null, receivedPaise: null };
}

export function parseStatementPages(pages, { sourceApp } = {}) {
  const detection = detectStatementSource(pages);
  const selectedSource = sourceApp || detection.app;
  if (!SUPPORTED_SOURCE_APPS.includes(selectedSource)) {
    return { requiresAppChoice: true, detection, pageCount: pages.length };
  }

  const allText = pages.flatMap((page) => page.lines || []).join(' ');
  const period = parseStatementPeriod(allText);
  const transactions = [];
  const skipped = [];
  const unreadable = [];
  const ambiguousDates = [];
  let rowCount = 0;

  for (const page of pages) {
    const blocks = blocksFromLines(page.lines || []);
    for (const block of blocks) {
      const result = parseBlock(block, page.page, selectedSource, period);
      if (result.kind === 'ignore') continue;
      rowCount += 1;
      if (result.kind === 'transaction') {
        transactions.push(result.transaction);
        if (result.ambiguousDate) ambiguousDates.push(page.page);
      } else if (result.kind === 'skipped') {
        skipped.push(result);
      } else if (result.kind === 'unreadable') {
        unreadable.push(result);
      }
    }
  }

  const uniqueTransactions = [...new Map(transactions.map((item) => [item.fingerprint, item])).values()]
    .sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`));
  const declared = declaredSummary(selectedSource, allText);
  const parsedPaid = uniqueTransactions.filter((item) => item.type === 'DEBIT').reduce((sum, item) => sum + item.amountPaise, 0);
  const parsedReceived = uniqueTransactions.filter((item) => item.type === 'CREDIT').reduce((sum, item) => sum + item.amountPaise, 0);
  const totalsComparable = skipped.length === 0 && unreadable.length === 0;
  const totalsMatch = totalsComparable
    && (declared.paidPaise === null || declared.paidPaise === parsedPaid)
    && (declared.receivedPaise === null || declared.receivedPaise === parsedReceived);

  const issues = [];
  if (!period && (selectedSource === 'navi' || selectedSource === 'paytm')) {
    issues.push('This statement does not show a usable date range, so dates without a year could not be verified.');
  }
  if (ambiguousDates.length) issues.push('Some dates could fall in more than one statement year and were interpreted from the stated period.');
  if (unreadable.length) issues.push(`${unreadable.length} row${unreadable.length === 1 ? '' : 's'} could not be read reliably.`);

  return {
    requiresAppChoice: !sourceApp && !detection.confident,
    detection,
    sourceApp: selectedSource,
    pageCount: pages.length,
    period,
    transactions: uniqueTransactions,
    skipped,
    unreadable,
    issues,
    summary: {
      rowsFound: rowCount,
      supportedRows: uniqueTransactions.length,
      duplicateRowsWithinFile: transactions.length - uniqueTransactions.length,
      skippedRows: skipped.length,
      unreadableRows: unreadable.length,
      declared,
      parsed: { paidPaise: parsedPaid, receivedPaise: parsedReceived },
      totalsComparable,
      totalsMatch,
    },
  };
}
