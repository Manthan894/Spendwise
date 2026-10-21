# TrackPay local acceptance checklist

This is a **localhost-only** test checklist. Do not deploy or configure public hosting until every applicable item is approved.

## 1. Start

```bash
npm install
npm run dev
```

- [ ] Local homepage says TrackPay.
- [ ] Browser shows the local development banner when no Supabase environment variables are set.
- [ ] Light/dark mode changes presentation without clearing visible data.
- [ ] Demo mode clearly says it is fictional and browser-only.
- [ ] Exit Demo removes the fictional view and does not add any demo entry to real/local imports.

## 2. Statement-import privacy

For every upload:

- [ ] Original PDF is selected from the browser and no network upload is performed by TrackPay.
- [ ] Closing/cancelling the import review saves no transactions.
- [ ] The original PDF file name is not displayed as a saved record.
- [ ] Unsupported scan/image-only PDFs produce a helpful error.
- [ ] Uncertain source detection opens the PhonePe / GPay / Paytm / Navi picker.

## 3. Adapter validation

Use only locally supplied/redacted original text-based statement PDFs. Do not commit them to source control.

- [ ] GPay: auto-detection, debit/credit direction, dates, amounts, IDs, and statement-total reconciliation.
- [ ] Paytm: auto-detection, signed debit/credit direction, year inference from statement period, IDs, and reconciliation.
- [ ] Navi: auto-detection, outgoing payment dates inferred from statement range, IDs, and amounts.
- [ ] PhonePe: import a real text-based PhonePe PDF and confirm the existing history/import path remains intact.
- [ ] Re-import the same statement and verify all rows are reported as duplicates, with no new save.

## 4. Import review

- [ ] Review identifies the selected/detected source app.
- [ ] It shows rows found, new rows, duplicates, skipped special rows, unreadable rows, and a preview.
- [ ] Confirming saves only new normal completed payments / normal received-money records.
- [ ] Refunds, reversals, cashbacks, self transfers, failed payments, and pending payments are never silently saved.

## 5. Analysis views

- [ ] `All` is newest first; search works for counterparty, description, and reference IDs.
- [ ] All filters work independently and together: date range, debit/credit, source app.
- [ ] Account suffixes are not shown or searchable.
- [ ] Monthly shows only imported months, at most 12 at a time, with separate paid/received values.
- [ ] Monthly pie chart includes outgoing debits only.
- [ ] Daily supports day browsing and drill-down; no daily pie chart appears.
- [ ] Years requires 12 continuous months and, when eligible, preserves paid/received values and shows a debit-only pie chart.

## 6. Supabase test-project checks (only after local UI approval)

- [ ] Run `supabase/trackpay-upgrade.sql` in the test project.
- [ ] Sign in with the same Google user that has Spendwise history; historic records appear as PhonePe rows.
- [ ] A second test user cannot read, import into, modify, or delete the first test user's records.
- [ ] Display-name edit updates TrackPay only, not the Google account profile.
- [ ] Clear data removes rows but leaves the TrackPay account usable.
- [ ] Deploy the protected `delete-account` Edge Function with its service-role key only in function secrets.
- [ ] Account deletion requires typing `DELETE`, removes transactions/profile/Auth identity, and leaves the Google account untouched.

## 7. Final local quality checks

```bash
npm run build
```

- [ ] Build succeeds.
- [ ] No real statement PDF, extracted sample row, `.env.local`, service-role key, database password, Google secret, or AWS credential is committed.
- [ ] Public hosting/deployment has **not** started yet.
