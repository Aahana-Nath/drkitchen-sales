# DrKitchen Sales

Daily sales entry for sellers + dashboards for regional managers and superadmin.
Next.js 15 (App Router) · Supabase (Postgres, phone login, row-level security) · Tailwind.

## Run it on your Mac

```bash
cd drkitchen-sales
npm install
cp .env.example .env.local      # then paste your Project URL + anon/publishable key
npm run dev                     # http://localhost:3000
```

Log in with a number listed under **Authentication → Sign In / Providers → Phone → Test Phone Numbers and OTPs**
(code = the one you set there, e.g. 123456). The number must also be on a row in `profiles`.

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
| `/login` | everyone | mobile number → 6-digit code |
| `/entry` | seller | today / yesterday (until 12:00 IST): 12 products × ₹10/50g/100g steppers, remarks, live ₹ total, submit (zero = "no sales") |
| `/entry?seller=…&date=…` | RM, superadmin | view / correct any seller-day in scope (logged) |
| `/me` | seller | month KPIs, daily chart, days submitted, by-product; own packets-by-spice pie chart with independent date range, quick dates (including all time), pack-size and spice filters |
| `/dashboard` | RM (own region), superadmin (all) | date range + quick ranges (including Yesterday and All time), region / seller filters, search, KPIs, date-wise chart, packets-by-spice pie chart with pack-size and spice filters, seller leaderboard with pack split, by-product, **Export Excel** (Summary / Daily / Lines) |
| `/dashboard/seller/[id]` | RM, superadmin | month day × SKU grid like the old DSR tab, day status colours, tap a day to correct, **Export DSR** in the old layout |
| `/admin/users` | superadmin | add / edit / deactivate users, phone, role, region, login status |
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

- Real SMS: Send SMS hook → MSG91 (after DLT), or switch to phone + PIN.
- Reminder at 8 pm to sellers who haven't submitted.
- Targets per seller.
