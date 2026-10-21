import * as pdfjsLib from 'pdfjs-dist';
import {
  buildFingerprint,
  detectStatementSource,
  parseStatementPages,
  sourceAppLabel,
  SUPPORTED_SOURCE_APPS,
  textItemsToLines,
} from './parserCore';

// The worker is bundled locally by Vite. Statement content remains on-device.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { buildFingerprint, detectStatementSource, sourceAppLabel, SUPPORTED_SOURCE_APPS };

function assertPdf(file) {
  if (!file || (file.type && file.type !== 'application/pdf' && !file.name?.toLocaleLowerCase().endsWith('.pdf'))) {
    throw new Error('Please choose an original PDF statement. Screenshots and scans are not supported.');
  }
}

async function extractPages(file, onProgress) {
  assertPdf(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes, useWorkerFetch: false });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress({ page: pageNumber, total: pdf.numPages });
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = textItemsToLines(content.items);
    pages.push({ page: pageNumber, lines });
  }

  if (!pages.some((page) => page.lines.length)) {
    throw new Error('This PDF has no selectable text. Please use the original text-based statement, not a screenshot or scan.');
  }
  return pages;
}

/**
 * Parses a supported payment-app PDF in the browser only. If statement source
 * detection is uncertain and no sourceApp was supplied, the caller receives a
 * requiresAppChoice result and can show the user the four-app picker.
 */
export async function parseSupportedStatementPdf(file, { sourceApp, onProgress = () => {} } = {}) {
  const pages = await extractPages(file, onProgress);
  const result = parseStatementPages(pages, { sourceApp });
  if (!result.requiresAppChoice && !result.transactions.length) {
    const name = result.sourceApp ? sourceAppLabel(result.sourceApp) : 'this';
    throw new Error(`No normal completed transactions could be read from ${name} statement. Use the original text-based PDF and check the selected app.`);
  }
  return result;
}

// Backward-compatible entry point for any existing PhonePe-only callers.
export async function parsePhonePePdf(file, onProgress = () => {}) {
  return parseSupportedStatementPdf(file, { sourceApp: 'phonepe', onProgress });
}

export function isSupportedSourceApp(value) {
  return SUPPORTED_SOURCE_APPS.includes(value);
}
