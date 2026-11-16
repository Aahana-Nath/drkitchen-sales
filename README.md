# DrKitchen Sales

Daily sales entry for sellers + dashboards for regional managers and superadmin.
Next.js 15 (App Router) · Supabase (Postgres, email OTP login, row-level security) · Tailwind.

## Run it on your Mac

```bash
cd drkitchen-sales
npm install
cp .env.example .env.local      # then paste your Project URL + anon/publishable key
npm run dev                     # http://localhost:3000
```

Log in with the email on an active `profiles` row and enter the emailed code.
Phone numbers are optional contact information, not login identities.

### Switching an existing database to email login

Apply `20261114000001_email_login.sql` to staging before deploying this UI.
It clears phone-login profile links; users cannot access their profiles until
an admin assigns their email and they verify it. Seller IDs and sales history
are preserved. Apply and verify separately in production when ready.

In Supabase Authentication, enable Email and disable Phone sign-in. Configure
the **Confirm signup** and **Magic Link** email templates to display
`{{ .Token }}` (not just a link). Configure SMTP for seller email delivery;
the default sender has recipient restrictions and low sending limits.
Initial email OTP login creates an Auth account, so email signups must be
enabled unless accounts are provisioned in advance.

Populate `profiles.email` with reviewed addresses in the SQL Editor or admin UI.
Set your own superadmin email explicitly before trying to log in. Review the
separate patch folder's email-load script before running it: it contains personal
addresses and automatically assigns an address to blank superadmin profiles.
Only confirmed email accounts link to profiles. Changing a profile's email removes
the previous login's access; changing a contact phone does not. Inactive profiles
remain blocked by RLS.

`email_allowed` is a public login-screen precheck, not a server-enforced restriction
on creating Auth accounts. It exposes whether an email is registered; unknown
accounts still have no profile or sales access under the database policies.

### Seller reminder emails

The dashboard's Pending overview can send a personal reminder to a seller who has
not submitted today's report. Configure the server-only `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `SMTP_FROM_NAME` variables
from `.env.example` in local `.env.local` and in the Vercel project's server
environment settings. Use the sender Gmail's App Password for `SMTP_PASSWORD`;
do not expose it through a `NEXT_PUBLIC_` variable. This is separate from
Supabase Auth's SMTP configuration. The server verifies the caller's manager
role, regional scope, seller status, and today's submission before sending.

### Local UI preview (no SMS or database writes)

To explore the dashboard and seller entry form before configuring Supabase, set
`NEXT_PUBLIC_LOCAL_DEMO_MODE=true` in `.env.local` and restart the dev server.
The preview uses sample data; entry changes are saved only in that browser's
local storage. Use the role selector in the header to switch between Manager
and Seller. This mode is disabled in production builds.

## Database changes

New migration in this version — push it once:

```bash
supabase link --project-ref wsjetggpmfwmfucdwiki
supabase db push --remote
```

`20261113000001_phone_change_relinks_login.sql` — when an admin changes someone's phone, the old number loses access.

## Deploy (Vercel)

1. Push this folder to a private GitHub repo.
2. vercel.com → **Add New → Project** → import the repo (framework auto-detected: Next.js).
3. **Environment Variables**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Then in Supabase → **Authentication → URL Configuration**, set **Site URL** to the Vercel URL.

Sellers open the URL on their phone → browser menu → **Add to Home Screen**.

## Screens

| Path | Who | What |
|---|---|---|
| `/login` | everyone | registered email → email verification code |
| `/entry` | seller | today / yesterday (until 12:00 IST): 12 products × ₹10/50g/100g steppers, remarks, live ₹ total, submit (zero = "no sales") |
| `/entry?seller=…&date=…` | RM, superadmin | view / correct any seller-day in scope (logged) |
| `/me` | seller | month KPIs, daily chart, days submitted, by-product; own packets-by-spice pie chart with independent date range, quick dates (including all time), pack-size and spice filters |
| `/dashboard` | RM (own region), superadmin (all) | date range + quick ranges (including Yesterday and All time), region / seller filters, search, KPIs, date-wise chart, packets-by-spice pie chart with pack-size and spice filters, seller leaderboard with pack split, by-product, **Export Excel** (Summary / Daily / Lines) |
| `/dashboard/seller/[id]` | RM, superadmin | month day × SKU grid like the old DSR tab, day status colours, tap a day to correct, **Export DSR** in the old layout |
| `/admin/users` | superadmin | add / edit / deactivate users, login email, optional contact phone, role, region, login status |
| `/admin/prices` | superadmin | current MRP + basic cost, schedule a price change from a date, hide/show SKUs |

All data access is enforced in the database; the UI only hides what a role can't use.

The manager's packets chart follows the dashboard Seller and From/To controls.
Pack-size and spice selections affect only the pie chart; its packet total
describes the selected subset. Sellers cannot choose another seller.
Hover a slice for its spice, packet count, and share. Local demo product sales use
30 days of sample history and respond to seller and date filters.

## Project layout

```
app/login/                 login
app/(app)/layout.tsx       loads profile, nav per role, route guard
app/(app)/entry/           seller entry + manager correction
app/(app)/me/              seller dashboard
app/(app)/dashboard/       manager/superadmin dashboard + seller drill-down
app/(app)/admin/           users, prices
lib/                       Supabase client, queries, formatting, Excel export
middleware.ts              session refresh + login redirect
supabase/                  migrations + seed (the database)
tests/                     database test scripts
```

## Later

- Reminder at 8 pm to sellers who haven't submitted.
- Targets per seller.
