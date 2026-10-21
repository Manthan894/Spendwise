# TrackPay — local-first statement analysis

TrackPay is the upgrade of Spendwise: a privacy-first student transaction-analysis web app for original, text-based payment-app statement PDFs.

> **Local first:** this project is intended to be built and approved on localhost before any public deployment work. The original PDF is parsed in the browser and is never uploaded or stored.

## Current local feature set

- Separate final-style splash, sign-in, and import-start pages for the local flow.
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

## Foundation security hardening and deployment

TrackPay's cloud writes are deliberately protected rather than sent directly from the browser:

- `commit-import` accepts confirmed rows only, derives duplicate fingerprints server-side, limits requests to 1 MB / 5,000 rows, validates every field, and rate-limits each account to **20 imports per hour**.
- `save-profile`, `clear-data`, and `delete-account` authenticate the JWT themselves and have limits of **10 changes per 10 minutes**, **5 clears per hour**, and **3 deletion attempts per hour** respectively.
- The database migration removes direct browser insert/update/delete policies. The browser can read only its own rows; mutations go only through the Edge Functions.
- Minimal security audit records contain only account ID, action, result, and time. A scheduled database cleanup permanently removes them after **30 days**. No transaction content, amount, counterparty, identifier, file name, or IP address is captured.
- Edge Functions reject unlisted web origins. Amplify's root `customHttp.yml` adds CSP, anti-framing, MIME, referrer, permissions, and HTTPS headers. AWS WAF is intentionally deferred from this Foundation tier.

**Deploy these parts together to the separate TrackPay Supabase project.** Do not apply this migration to the existing Spendwise production project while testing.

1. Copy and commit `supabase/functions`, `supabase/trackpay-security-hardening.sql`, the frontend changes, and root `customHttp.yml` to the TrackPay branch. Never commit `.env.local`, statement PDFs, uploads, or any credential.
2. In the Supabase CLI, authenticate/link to the TrackPay project. Set the exact browser origins that may use the functions (comma separated, no trailing slash). `http://localhost:5173` is already allowed for local development; add each hosted Amplify URL separately.

   ```bash
   npx supabase secrets set ALLOWED_ORIGINS="https://YOUR-TRACKPAY-TEST.amplifyapp.com" --project-ref YOUR_TRACKPAY_PROJECT_REF
   ```

   The Supabase Edge runtime must have its server-only `SUPABASE_SERVICE_ROLE_KEY` available. It never belongs in Vite variables, Git, AWS Amplify variables, or browser code.
3. Deploy all four functions from the repository root, then run the SQL migration in Supabase SQL Editor.

   ```bash
   npx supabase functions deploy commit-import --project-ref YOUR_TRACKPAY_PROJECT_REF
   npx supabase functions deploy save-profile --project-ref YOUR_TRACKPAY_PROJECT_REF
   npx supabase functions deploy clear-data --project-ref YOUR_TRACKPAY_PROJECT_REF
   npx supabase functions deploy delete-account --project-ref YOUR_TRACKPAY_PROJECT_REF
   ```

   Run the entire contents of `supabase/trackpay-security-hardening.sql` once. It enables the daily `pg_cron` privacy-audit cleanup job as well as the rate-limit RPC and RLS write lockdown.
4. Only after the functions and SQL migration succeed, deploy the matching TrackPay frontend to Amplify. Configure only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as frontend environment values. Add the deployed Amplify origin to Supabase Auth URL Configuration and Google OAuth redirect configuration.
5. Smoke-test a signed-in account: import confirmed test rows, change display name, clear data, then test account deletion last. In Supabase Logs, check only expected function success/error events; do not place test statement contents in logs or tickets.

Clearing data and deleting an account remain different:

- **Clear saved transaction data** deletes only the signed-in user's stored transaction records.
- **Delete TrackPay account** deletes the user's Supabase Auth identity. Database foreign-key cascades remove the TrackPay profile, transactions, and rate-limit rows; the minimal deletion audit event remains for no more than 30 days.

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
npm audit --omit=dev --audit-level=high
```

The current production build and production-dependency audit succeed with no reported vulnerabilities. Vite reports a non-blocking bundle-size warning because PDF.js is bundled locally so the PDF is not sent to a third party.
