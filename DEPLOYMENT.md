# UGC OS — Deployment guide

This walks you through everything needed to host UGC OS as a private,
Skool-gated app for your community. Estimated time end-to-end: 60–90 min.

The stack:

- **Frontend:** Vite SPA on Vercel (free Hobby tier)
- **Auth + Postgres:** Supabase (free → Pro $25/mo when you grow)
- **Asset blob storage:** Cloudflare R2 ($0 egress)
- **Membership sync:** Zapier zap from Skool → Supabase allowlist

**Related docs.** The canonical database schema (tables, RLS policies,
triggers) lives in [`supabase/migrations/0001_initial.sql`](supabase/migrations/0001_initial.sql)
— treat it as the source of truth and re-run it when bootstrapping a
new Supabase project. The client↔Postgres sync bridge is
[`src/lib/cloudSync.ts`](src/lib/cloudSync.ts); the presigned-URL
edge function is [`api/r2-sign.ts`](api/r2-sign.ts). For the threat
model and known limitations, see [SECURITY.md](SECURITY.md).

---

## 1. Supabase project

1. Create a new project at https://supabase.com → name it `ugc-lab`.
2. Copy these from **Settings → API**:
   - **Project URL** → goes into `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - **anon public key** → goes into `VITE_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`
3. Open **SQL Editor** → "New query" → paste the contents of
   `supabase/migrations/0001_initial.sql` → click **Run**. This creates
   the `profiles`, `allowlist`, bank tables, `assets` table, RLS
   policies, and the signup trigger that gates new signups against the
   allowlist.
   Then run every later file in `supabase/migrations/` in number order
   (each is idempotent, so re-running one is safe). `0021_signup_code.sql`
   is what adds the **access code** new members type on the Create account
   form — it defaults to `3500` and you can change it any time in
   **Admin → Allowlist** (clearing it turns the code off). Skip that
   migration and the field still shows, but nothing checks what's typed.
   `0023_lapsed_status.sql` adds the **Lapsed** member status and the
   `redeem_access_code` RPC behind it — skip it and Admin → Members simply
   shows no Lapsed pill and no Lapse button.
   `0024_tracked_accounts.sql` adds the table behind Outliers' **Accounts**
   tab, and unlike the two above it must be run **before** the frontend is
   deployed: the client hydrates every bank table on sign-in, so a missing
   one makes every member's hydrate report a per-table error (and skips that
   session's orphan-asset sweep).
4. Add yourself to the allowlist so you can sign up:
   ```sql
   insert into public.allowlist (email, source) values ('you@example.com', 'manual');
   ```
5. Sign up at the deployed app (or `npm run dev`). You'll get the
   "not on access list" error if you skipped step 4.
6. Promote yourself to admin so you can see the Admin page:
   ```sql
   select public.bootstrap_admin('you@example.com');
   ```

### Email confirmation

By default, Supabase sends a confirmation email on signup. For a community
where you've already vetted members via the allowlist, you can disable this
in **Auth → Providers → Email → Confirm email = off** for a smoother UX.

### Password reset (two settings, both required)

The sign-in screen has a **Forgot your password?** link. It sends a Supabase
recovery email; the link lands the member on `/reset-password`, where the app
takes over and makes them set a new password before it opens the workspace.

1. **Auth → URL Configuration → Redirect URLs** — add
   `https://<your-domain>/reset-password` (and `http://localhost:5173/reset-password`
   if you want it to work in `npm run dev`). Supabase refuses to redirect
   anywhere not on this list, so without it every reset link dead-ends.
2. **Auth → SMTP Settings** — point it at a real sender (Resend, Postmark,
   SendGrid). Supabase's built-in sender is a testing convenience: it is rate
   limited per project and its mail routinely lands in spam. That is tolerable
   for a signup confirmation you told the member to expect; it is not tolerable
   for the one email a locked-out member is waiting on. One-time setup, no
   ongoing work.

Reset links expire after an hour. A member who lets one lapse just requests
another — the screen says so.

---

## 2. Cloudflare R2 bucket

1. Create a Cloudflare account if you don't have one.
2. **R2 → Create bucket** → name it `ugc-lab-assets` → region: Automatic.
3. **Manage R2 API Tokens → Create API Token** → permissions:
   *Object Read & Write* → bucket: this one only. Save:
   - **Account ID** → `R2_ACCOUNT_ID`
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
4. (Optional) Bind a custom domain to the bucket for prettier URLs. Not
   required — presigned URLs work against the default endpoint.

### CORS

Add this CORS policy to the bucket so the browser can PUT directly:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.com", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`PUT` is required — uploads use a presigned **PUT** URL. Do **not** switch this
to a presigned POST policy to bind size/MIME caps: Cloudflare R2 does not
implement the S3 POST Object operation and returns `501 Not Implemented`, which
the browser surfaces as an opaque "Failed to fetch / CORS" error. (We tried it
in PR #111 and it broke every upload.) `GET`/`HEAD` cover presigned downloads.

Replace `https://your-domain.com` with your actual deployed domain after
step 3 below.

---

## 3. Vercel deploy

1. Push this repo to GitHub.
2. **Vercel → Import Project** → select the repo. Framework: **Vite**.
3. Set **Environment Variables** (Settings → Environment Variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL` (same value, exposed only to the API route)
   - `SUPABASE_ANON_KEY`
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET=ugc-lab-assets`
4. Deploy. The first deploy will publish your SPA at
   `https://ugc-lab.vercel.app` (or your custom domain) and stand up the
   `/api/r2-sign` Edge function.
5. Update the R2 bucket CORS policy with your real Vercel domain.

**Deploys land under members who are already using the app.** The build stamps
itself with `VERCEL_GIT_COMMIT_SHA` and writes that id to `/version.json`
(`vite.config.ts`); the running app re-reads that file and offers a reload when
the two disagree, and catches the stale-chunk failure if the member gets there
first (`hooks/useAppUpdateCheck.ts`, `components/AppErrorBoundary.tsx`). Two
things have to stay true on any host: **`/version.json` must be served
uncached** (the `Cache-Control: no-store` rule in `vercel.json`) and it must be
served as the real file rather than swallowed by the SPA rewrite — Vercel checks
the filesystem before rewriting, so it is.

---

## 4. Zapier sync (Skool → allowlist)

Set up two zaps. Both use **Skool** as the trigger and **Supabase** as the
action. Skool's Zapier app exposes "New Member" and "Member Removed"
triggers.

### Zap 1 — Add member to allowlist

- **Trigger:** Skool → New Member of Group → select your group.
- **Action:** Supabase → Create Row
  - Table: `allowlist`
  - email: `{{Member Email}}`
  - source: `skool`

### Zap 2 — Remove member from allowlist

- **Trigger:** Skool → Member Removed from Group.
- **Action:** Supabase → Delete Row
  - Table: `allowlist`
  - filter: `email = {{Member Email}}`

The schema's `on_allowlist_delete` trigger automatically marks the matching
profile as `lapsed_at` (migration 0023 — it stamped `disabled_at` before that),
and the app locks them out on next page load. Lapsed is the softer of the two
locks: their data is untouched and they let themselves back in by entering the
current access code, without you doing anything. A ban is still a deliberate
**Disable** on the Members table, and a member who is already disabled is left
disabled rather than being downgraded to lapsed.

If the Skool trigger you need isn't available natively, you can use the
**Webhooks by Zapier** trigger and configure Skool to POST to that webhook URL.

---

## 5. Verification (matches the plan)

- **Phase A:** Try to sign up with a non-allowlisted email → fails with the
  "not on access list" error. Add to allowlist via Admin → Allowlist or
  Supabase Studio. Sign up succeeds; `profiles` row exists.
- **Phase B:** In Browser A, add a Product. Sign in to the same account in
  Browser B; refresh — the Product appears (cloud sync hydrated). Edit in
  B; A picks it up on its next refresh.
- **Phase C:** Generate a B-Roll image in Browser A. Confirm a row in
  `assets` (Supabase) and an object in R2. In Browser B, open the B-Roll
  Bank — image renders (lazy-fetched from R2 to local IndexedDB cache).
- **Phase D:** As admin, see the Admin entry in the sidebar. Members table
  lists everyone with storage usage. Allowlist editor lets you add/remove
  emails. Disable a member; they're bounced on next request.
- **Phase D2:** Sign out, hit **Forgot your password?**, and confirm the mail
  arrives and its link lands on `/reset-password` rather than the dashboard.
  Set a new password; you should land straight in the workspace.
- **Phase D3:** **Lapse** a test member in Admin → Members. Sign in as them:
  the workspace is replaced by the access-code screen and no bank data loads.
  Enter the current code from Admin → Allowlist — the workspace comes back
  with every product, character and generation still there.
- **Phase E:** Add a fake member to your Skool. Within ~1 minute the
  Zapier zap fires and the email appears in `allowlist`. Sign up at the
  deployed URL — works.

---

## Cost expectations (year 1, 250–1000 members)

| Line | Cost |
|---|---|
| Vercel Hobby | $0 |
| Supabase Pro | $25/mo |
| Cloudflare R2 | $5–15/mo (mostly storage; egress is free) |
| Zapier Starter | $0–20/mo (depending on zap volume) |
| **Total** | **~$30–60/mo** |

kie.ai inference cost is on members (BYO key), so this is the entire
infra envelope.

---

## Local development

1. `cp .env.example .env.local` and fill in your Supabase values.
2. `npm install`
3. `npm run dev` → http://localhost:5173

If `.env.local` is missing the Supabase vars, the app boots in **local-only
mode** (no auth, no cloud sync) so you can iterate on UI without a backend.
A small banner at the bottom of the screen reminds you.

The R2 sign route only runs in `vercel dev` or in a production deploy.
For local cloud-sync development, run:

```
npx vercel dev
```

…with the same `.env.local` to get the API route serving locally on port 3000.
