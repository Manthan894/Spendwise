# TrackPay — Final Pre-Public-Launch Checklist

**Release state:** protected staging → small beta → public launch

Do not remove AWS Amplify password protection until every **Launch blocker** below is complete.

---

## Launch blockers

### 1. Public trust pages

- [ ] `/?page=privacy` opens on the deployed Amplify website.
- [ ] `/?page=terms` opens on the deployed Amplify website.
- [ ] `/?page=help` opens on the deployed Amplify website.
- [ ] All three pages show a real monitored support email, not `support@spendwise.example`.
- [ ] Footer Privacy, Terms, and Help & Contact links work on desktop and mobile.
- [ ] The Privacy Policy description matches the actual product: PDF stays in the browser; extracted transaction fields are stored after sign-in.

### 2. Authentication and user isolation

- [ ] Google OAuth publishing status is **In production**.
- [ ] A Google account not in the former Test users list can sign in successfully.
- [ ] A new Google account sees an empty import screen, not another user’s data.
- [ ] Sign out works on a computer and phone.
- [ ] The Supabase `transactions` table has RLS enabled with the own-row read policy only; browser insert/update/delete policies are absent.
- [ ] Supabase URL Configuration includes the deployed Amplify URL and `http://localhost:5173` for development.

### 3. Import quality

- [ ] Test supported original, text-based PhonePe, GPay, Paytm, and Navi PDF layouts. Do not commit or retain test statements.
- [ ] Include at least one one-month statement and one overlapping/two-month statement.
- [ ] Check every imported transaction count against the original statement.
- [ ] Check several debit, credit, amount, date, time, and counterparty values manually.
- [ ] Upload the same PDF again and confirm all duplicates are skipped.
- [ ] Confirm a scanned/image-only PDF produces a clear failure message, not incorrect data.
- [ ] Confirm only months that actually exist in imported statements are shown.
- [ ] Confirm the 12-month paging limit works if test data covers more than 12 months.

### 4. Cross-device and deletion checks

- [ ] Import data on a computer and confirm it appears on a phone after signing in with the same Google account.
- [ ] With disposable test data, use **Help & Contact → Delete all imported data**.
- [ ] Confirm the dashboard becomes empty after deletion.
- [ ] Refresh the website and sign in from another device; confirm the deleted rows do not return.
- [ ] In Supabase Table Editor, confirm that test user’s transaction rows were removed.
- [ ] Confirm the in-app deletion flow calls the deployed `delete-account` Edge Function and removes the Auth user plus all cascading TrackPay rows. The browser must never hold an admin key.

### 5. Security and source-code check

- [ ] GitHub repository is private during beta testing.
- [ ] GitHub contains no real supported payment-app PDFs, screenshots with personal data, `.env.local`, database passwords, Google client secrets, Supabase secret keys, or service-role keys.
- [ ] Browser code and Amplify variables use only `VITE_SUPABASE_URL` and the Supabase publishable key.
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_...`, Google client secret, and database password are never used in frontend code or committed to Git.
- [ ] All four Edge Functions (`commit-import`, `save-profile`, `clear-data`, and `delete-account`) are deployed to the same TrackPay Supabase project, and `ALLOWED_ORIGINS` contains the exact Amplify origin.
- [ ] `supabase/trackpay-security-hardening.sql` has been run once: direct write policies are removed, rate-limit RPC is present, and the 30-day audit cleanup cron job is active.
- [ ] The deployed Amplify response includes the security headers in root `customHttp.yml` (especially CSP, HSTS, X-Frame-Options, and nosniff).
- [ ] The production site uses HTTPS (Amplify provides this automatically on its hosted URL).
- [ ] The deployed website no longer shows “Local preview”.

### 6. Cost and operations

- [ ] In AWS Billing → Budgets, create a monthly cost budget alert. An alert does not hard-stop spending, but it warns you before unexpected charges grow.
- [ ] Add your email for budget alerts at a low threshold you are comfortable monitoring.
- [ ] Review the current AWS Amplify free-tier/usage screen and Supabase free-plan usage screen.
- [ ] Do not create unused EC2, RDS, NAT Gateway, CloudFront, Lambda, or S3 resources for this static v1 website.
- [ ] Keep a copy of the source code in GitHub; do not rely only on local files.

### 7. Mobile and accessibility review

- [ ] Test on Android Chrome and a desktop browser.
- [ ] Test the upload area, Google Sign-In, monthly view, daily view, transaction detail, and delete button on mobile.
- [ ] Check that text is readable without zooming and buttons are easy to tap.
- [ ] Verify policy pages work from direct links, not only from footer navigation.

---

## Controlled public release

When every launch blocker is checked:

1. In AWS Amplify → TrackPay → Hosting → Access control, choose **Manage access**.
2. Disable password-required access for the public branch and save.
3. Open the website in an incognito window and confirm no Amplify username/password prompt appears.
4. Sign in with a regular Google account and verify the app works.
5. Invite a small beta group first (for example, 5–10 trusted students), rather than announcing broadly on day one.
6. Ask beta users to report PDF layouts that fail to parse. Do not ask them to send statements through chat; ask for a redacted layout screenshot or parser-error details.

---

## First-week monitoring

- Check AWS and Supabase usage daily for the first week.
- Monitor the support inbox.
- Track parser issues by PhonePe statement layout/date range.
- Keep Amplify, Supabase, and Google OAuth settings unchanged unless a clear issue requires a fix.
- If a privacy/security issue is reported, re-enable Amplify password protection while investigating.

---

## Launch decision

Proceed only if the answer to each question is **yes**:

1. Can a new student sign in?
2. Can they import a supported original payment-app PDF correctly?
3. Can they see their data on another device?
4. Can they delete their imported data?
5. Can a different user see only an empty dashboard?
6. Is the Privacy Policy live with a real support email?
7. Are budget alerts and source-code secrets checks complete?
