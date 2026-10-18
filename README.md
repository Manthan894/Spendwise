# TrackPay — local-first statement analysis

TrackPay is the upgrade of Spendwise: a privacy-first student transaction-analysis web app for original, text-based payment-app statement PDFs.

> **Local first:** this project is intended to be built and approved on localhost before any public deployment work. The original PDF is parsed in the browser and is never uploaded or stored.

## Current local feature set

- Supported statement adapters: **PhonePe, GPay, Paytm, and Navi**.
- Local source detection with a clear PhonePe/GPay/Paytm/Navi chooser when detection is uncertain.
- Parse → **import review** → explicit save confirmation. No parsed transaction saves automatically.
- Review shows source app, rows found, new rows, existing duplicates, intentionally skipped special rows, unreadable rows, and a preview.
- GPay and Paytm reconciliation checks compare parsed totals with statement header totals when the comparison is valid.
- `All | Monthly | Daily | Years` navigation.
- All Transactions is newest first and has search, date-range, debit/credit, and source-app filters.
- Monthly and Years include debit-only spending pie charts. Daily deliberately has no chart.
- Exact-name grouping: TrackPay never fuzzy-merges similar looking names.
- Light/dark mode and TrackPay-only display-name editing.
- Browser-only fictional demo mode; it never writes to Supabase and never merges with real account data.
- Google Sign-In, Supabase account isolation/RLS, cloud history pagination, duplicate prevention, clear-data, and a protected real account-deletion path.

## Deliberate transaction rules

TrackPay imports only **normal completed payments** and **normal received-money** records.

It intentionally skips rows identified as:

- refund
- reversal
- cashback
- self transfer
- failed, declined, or cancelled payment
- pending payment

Navi's user statement export supplies outgoing payment data only, so the Navi adapter does not claim to import received-money entries.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal. The app binds to `0.0.0.0` for the Arena preview environment.

Without Supabase environment variables, the product runs in **local development mode**. Real imported records stay in that browser's local storage solely for local validation. Demo data is session-only and separate.

## Browser environment variables

Create `.env.local` from `.env.example` and add only public Supabase configuration:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Never put these secrets in browser code or Vite variables:

- Supabase `service_role` / secret key
- database password
- Google OAuth client secret
- AWS credentials

## Existing Spendwise → TrackPay migration

1. Keep the existing `transactions` table and all rows.
2. In Supabase SQL Editor, run:

   ```text
   supabase/trackpay-upgrade.sql
   ```

   It adds `source_app`, marks existing Spendwise history as `phonepe`, and creates the RLS-protected `profiles` table for TrackPay-only display names.
3. Configure the two public browser environment variables above.
4. Start TrackPay locally and sign in with the same Google account. Existing history remains available and is shown as PhonePe records.

For a completely new Supabase project, run `supabase/schema.sql` first and then `supabase/trackpay-upgrade.sql`.

## Real account deletion

Clearing data and deleting an account are intentionally different:

- **Clear saved transaction data** deletes only the signed-in user's stored transaction records.
- **Delete TrackPay account** deletes the user's Supabase Auth identity. The database foreign-key cascades remove their TrackPay profile and transaction rows.

The browser must not receive an admin key. The protected server-side function is in:

```text
supabase/functions/delete-account/index.ts
```

Before enabling the button against a real Supabase project:

```bash
supabase functions deploy delete-account
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Keep that service-role value only in Supabase Edge Function secrets. Do **not** add it to `.env.local`, Vite variables, Git, or the frontend.

## Google sign-in checklist for localhost

In Supabase Auth → URL Configuration and Google Cloud OAuth configuration, include the local URL used by Vite, commonly:

```text
http://localhost:5173
```

Also retain your Supabase callback URL in the Google OAuth client's allowed redirect URIs. Do not proceed to public-hosted URL configuration until the localhost build is approved.

## Parser validation coverage

The local adapters were validated against supplied original text-based GPay, Paytm, and Navi PDFs. Validation samples are not embedded in source code, demo data, or cloud storage. PhonePe's historic adapter and data migration path are preserved.

Supported PDF layouts can evolve. When source identification is uncertain, TrackPay asks the user to select the app rather than guessing. If a row cannot be read reliably, the import review reports it and never silently saves it.

## Quality checks used in this workspace

```bash
npm run build
```

The build currently succeeds. Vite reports a non-blocking bundle-size warning because PDF.js is bundled locally so the PDF is not sent to a third party.
