import * as pdfjsLib from 'pdfjs-dist';

// The worker is bundled locally by Vite. No statement content is sent to a server.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const DATE_RE = /\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\b/;
const TIME_RE = /\b(\d{1,2}:\d{2}\s*[AP]M)\b/i;
const TYPE_RE = /\b(DEBIT|CREDIT)\b/i;
const AMOUNT_RE = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i;

function clean(value = '') {
  return value.replace(/\s+/g, ' ').replace(/[\u00a0\u200b]/g, ' ').trim();
}

function parseStatementDate(value) {
  const found = clean(value).match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!found) return null;
  const month = MONTHS[found[1].toLowerCase()];
  if (month === undefined) return null;
  return `${found[3]}-${String(month + 1).padStart(2, '0')}-${String(found[2]).padStart(2, '0')}`;
}

function toPaise(amountText) {
  if (!amountText) return null;
  const number = Number(String(amountText).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function smallHash(input) {
  // A deterministic browser-only fingerprint is used only for duplicate prevention.
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function textItemsToLines(items) {
  const positioned = items
    .filter((item) => clean(item.str))
    .map((item) => ({
      text: clean(item.str),
      x: item.transform[4],
      y: item.transform[5],
    }))
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
    .map(clean)
    .filter(Boolean);
}

function counterpartyFromBlock(block, fallback) {
  const labels = [
    'Paid to',
    'Received from',
    'Transfer to',
    'Transfer from',
    'Refund from',
    'Cashback from',
    'Payment to',
  ];

  for (const label of labels) {
    const expression = new RegExp(`${label}\\s+(.+?)(?=\\s+(?:DEBIT|CREDIT|Transaction ID|UTR No\\.?|Paid by|Credited to)\\b|$)`, 'i');
    const result = block.match(expression);
    if (result?.[1]) return clean(result[1].replace(/[₹].*$/, ''));
  }

  const withoutMetadata = clean(
    fallback
      .replace(DATE_RE, '')
      .replace(TIME_RE, '')
      .replace(TYPE_RE, '')
      .replace(AMOUNT_RE, '')
      .replace(/Transaction ID.*$/i, ''),
  );
  return withoutMetadata || 'Unknown counterparty';
}

function parseRecord(blockLines, page) {
  const block = clean(blockLines.join(' '));
  const dateMatch = block.match(DATE_RE);
  const date = dateMatch ? parseStatementDate(dateMatch[1]) : null;
  const typeMatch = block.match(TYPE_RE);
  const amountMatch = block.match(AMOUNT_RE);
  const transactionId = block.match(/Transaction\s*ID\s*[:.]?\s*([A-Z0-9-]{8,})/i)?.[1] || null;
  const utr = block.match(/UTR\s*(?:No\.)?\s*[:.]?\s*([A-Z0-9-]{6,})/i)?.[1] || null;
  const accountLast4 = block.match(/(?:[Xx*]{3,}|ending\s+)(\d{4})\b/)?.[1] || null;
  const amountPaise = toPaise(amountMatch?.[1]);
  const type = typeMatch?.[1]?.toUpperCase();
  const time = block.match(TIME_RE)?.[1]?.toUpperCase().replace(/\s+/g, ' ') || null;
  const firstUsefulLine = blockLines.find((line) => !/^Date\s+Transaction Details/i.test(line)) || block;
  const counterparty = counterpartyFromBlock(block, firstUsefulLine);

  if (!date || !type || amountPaise === null) return null;
  const action = block.match(/\b(Paid to|Received from|Transfer to|Transfer from|Refund from|Cashback from|Payment to)\b/i)?.[1];
  const description = action ? `${action} ${counterparty}` : clean(
    firstUsefulLine.replace(DATE_RE, '').replace(TIME_RE, '').replace(TYPE_RE, '').replace(AMOUNT_RE, ''),
  );
  const fingerprint = smallHash([
    transactionId || '', date, time || '', type, amountPaise, counterparty.toLowerCase(), utr || '',
  ].join('|'));

  return {
    fingerprint,
    transactionId,
    utr,
    date,
    time,
    type,
    amountPaise,
    counterparty,
    accountLast4,
    description: description || `${type === 'DEBIT' ? 'Paid to' : 'Received from'} ${counterparty}`,
    page,
  };
}

function blocksFromLines(lines) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (/^Date\s+Transaction Details/i.test(line) || /^Page\s+\d+/i.test(line)) continue;
    if (DATE_RE.test(line)) {
      if (current?.length) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current?.length) blocks.push(current);
  return blocks;
}

/**
 * Extracts a PhonePe statement locally in the browser. It expects the standard
 * text-based PhonePe table shown in the supplied reference images. Scanned PDFs
 * need OCR and are deliberately surfaced as review-needed rather than uploaded.
 */
export async function parsePhonePePdf(file, onProgress = () => {}) {
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Please choose a PDF statement downloaded from PhonePe.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes, useWorkerFetch: false });
  const pdf = await loadingTask.promise;
  const transactions = [];
  const issues = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress({ page: pageNumber, total: pdf.numPages });
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = textItemsToLines(content.items);
    const blocks = blocksFromLines(lines);

    if (!lines.length) {
      issues.push(`Page ${pageNumber} has no selectable text. It may be a scanned PDF.`);
    }

    for (const block of blocks) {
      const record = parseRecord(block, pageNumber);
      if (record) transactions.push(record);
    }
  }

  const unique = [...new Map(transactions.map((item) => [item.fingerprint, item])).values()]
    .sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`));

  if (!unique.length) {
    throw new Error('No PhonePe transactions could be read. Please use the original text-based PDF, not a screenshot or scanned copy.');
  }

  return {
    transactions: unique,
    pageCount: pdf.numPages,
    issues,
  };
}

export function buildFingerprint(transaction) {
  return transaction.fingerprint || smallHash([
    transaction.transactionId || '', transaction.date, transaction.time || '', transaction.type,
    transaction.amountPaise, transaction.counterparty?.toLowerCase() || '', transaction.utr || '',
  ].join('|'));
}
