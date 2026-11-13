-- DrKitchen Sales — save RPC, views and dashboard functions.
-- Views use security_invoker and functions run as the caller, so access rules apply:
-- a seller only ever gets their own numbers, a regional manager their region's.

-- ───────────────────────── Save a day's entry (one call) ─────────────────────────
-- p_lines: [{"sku_code": "TUR-P-10", "quantity": 12}, ...]  (sku_id also accepted)
-- Lines with quantity 0 are removed; a report with no lines = submitted zero-sale day.
-- p_seller defaults to the caller; managers/superadmin may pass a seller to correct.
create or replace function public.save_daily_report(
  p_date    date,
  p_lines   jsonb,
  p_remarks text default null,
  p_seller  uuid default null
) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_seller uuid := coalesce(p_seller, my_profile_id());
  v_report bigint;
begin
  if my_profile_id() is null then
    raise exception 'No active profile for this login';
  end if;
  if v_seller <> my_profile_id() and my_role() = 'seller' then
    raise exception 'Sellers can only file their own sales';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where not exists (select 1 from skus s
                                 where s.is_active
                                   and (s.id = (l ->> 'sku_id')::smallint or s.code = l ->> 'sku_code'))) then
    raise exception 'Unknown or inactive SKU in p_lines';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
              where coalesce((l ->> 'quantity')::int, -1) < 0) then
    raise exception 'Every line needs a quantity >= 0';
  end if;

  insert into daily_reports (seller_id, report_date, region_id, remarks)
  values (v_seller, p_date, 0, p_remarks)          -- region_id stamped by trigger
  on conflict (seller_id, report_date) do update set remarks = coalesce(excluded.remarks, daily_reports.remarks)
  returning id into v_report;

  with input as (
    select s.id as sku_id, sum((l ->> 'quantity')::int) as quantity
      from jsonb_array_elements(p_lines) l
      join skus s on s.id = (l ->> 'sku_id')::smallint or s.code = l ->> 'sku_code'
     group by s.id
  ), del as (
    delete from daily_report_lines d
     using input i
     where d.report_id = v_report and d.sku_id = i.sku_id and i.quantity = 0
  )
  insert into daily_report_lines (report_id, sku_id, quantity, unit_mrp, unit_rbc)
  select v_report, sku_id, quantity, 0, 0 from input where quantity > 0   -- prices stamped by trigger
  on conflict (report_id, sku_id) do update set quantity = excluded.quantity;

  return v_report;
end $$;

-- ───────────────────────── Flat sales view ─────────────────────────
create or replace view public.v_sales_lines with (security_invoker = true) as
select r.report_date,
       r.seller_id,
       p.full_name           as seller_name,
       r.region_id,
       g.name                as region_name,
       pr.id                 as product_id,
       pr.name               as product_name,
       s.id                  as sku_id,
       s.code                as sku_code,
       s.pack_size,
       l.quantity,
       l.unit_mrp,
       l.unit_rbc,
       l.line_value,
       round(l.quantity * l.unit_mrp, 2) as mrp_value
  from daily_report_lines l
  join daily_reports r on r.id = l.report_id
  join profiles p      on p.id = r.seller_id
  join regions g       on g.id = r.region_id
  join skus s          on s.id = l.sku_id
  join products pr     on pr.id = s.product_id;

-- One row per submitted report (zero-sale days included)
create or replace view public.v_daily_seller_totals with (security_invoker = true) as
select r.id as report_id,
       r.report_date,
       r.seller_id,
       p.full_name as seller_name,
       r.region_id,
       g.name      as region_name,
       r.remarks,
       r.submitted_at,
       coalesce(sum(l.quantity), 0)                                          as pieces,
       coalesce(sum(l.line_value), 0)                                        as sales_value,
       coalesce(sum(l.quantity)   filter (where s.pack_size = 'rs10'), 0)    as rs10_pieces,
       coalesce(sum(l.quantity)   filter (where s.pack_size = 'g50'), 0)     as g50_pieces,
       coalesce(sum(l.quantity)   filter (where s.pack_size = 'g100'), 0)    as g100_pieces,
       coalesce(sum(l.line_value) filter (where s.pack_size = 'rs10'), 0)    as rs10_value,
       coalesce(sum(l.line_value) filter (where s.pack_size = 'g50'), 0)     as g50_value,
       coalesce(sum(l.line_value) filter (where s.pack_size = 'g100'), 0)    as g100_value
  from daily_reports r
  join profiles p on p.id = r.seller_id
  join regions g  on g.id = r.region_id
  left join daily_report_lines l on l.report_id = r.id
  left join skus s on s.id = l.sku_id
 group by r.id, p.full_name, g.name;

-- ───────────────────────── Dashboard: per-seller summary ─────────────────────────
-- Mirrors the Excel dashboard + pack-size block. Includes sellers with no sales.
create or replace function public.report_seller_summary(
  p_from          date,
  p_to            date,
  p_region        smallint default null,
  p_seller        uuid     default null,
  p_low_threshold numeric  default null
) returns table (
  seller_id            uuid,
  seller_name          text,
  region_id            smallint,
  region_name          text,
  days_reported        int,
  days_with_sales      int,
  pieces               bigint,
  sales_value          numeric,
  value_share          numeric,
  pieces_per_sales_day numeric,
  value_per_sales_day  numeric,
  rank_by_value        int,
  low_value_days       int,
  rs10_pieces bigint, g50_pieces bigint, g100_pieces bigint,
  rs10_value numeric, g50_value numeric, g100_value numeric
)
language sql stable security invoker set search_path = public as $$
  with params as (
    select coalesce(p_low_threshold,
                    (select (value #>> '{}')::numeric from app_settings where key = 'low_day_threshold'),
                    7500) as low
  ), sellers as (
    select p.id, p.full_name, p.region_id, g.name as region_name
      from profiles p join regions g on g.id = p.region_id
     where p.role = 'seller'
       and (p_region is null or p.region_id = p_region)
       and (p_seller is null or p.id = p_seller)
       and (p.is_active or exists (select 1 from daily_reports r
                                    where r.seller_id = p.id and r.report_date between p_from and p_to))
  ), days as (
    select d.* from v_daily_seller_totals d
     where d.report_date between p_from and p_to
       and (p_region is null or d.region_id = p_region)
       and (p_seller is null or d.seller_id = p_seller)
  ), agg as (
    select s.id, s.full_name, s.region_id, s.region_name,
           count(d.report_id)::int                                   as days_reported,
           count(d.report_id) filter (where d.pieces > 0)::int       as days_with_sales,
           coalesce(sum(d.pieces), 0)::bigint                        as pieces,
           coalesce(sum(d.sales_value), 0)                           as sales_value,
           count(d.report_id) filter (where d.pieces > 0
                                        and d.sales_value < (select low from params))::int as low_value_days,
           coalesce(sum(d.rs10_pieces), 0)::bigint as rs10_pieces,
           coalesce(sum(d.g50_pieces), 0)::bigint  as g50_pieces,
           coalesce(sum(d.g100_pieces), 0)::bigint as g100_pieces,
           coalesce(sum(d.rs10_value), 0) as rs10_value,
           coalesce(sum(d.g50_value), 0)  as g50_value,
           coalesce(sum(d.g100_value), 0) as g100_value
      from sellers s
      left join days d on d.seller_id = s.id
     group by s.id, s.full_name, s.region_id, s.region_name
  )
  select a.id, a.full_name, a.region_id, a.region_name,
         a.days_reported, a.days_with_sales, a.pieces, a.sales_value,
         case when sum(a.sales_value) over () = 0 then 0
              else round(a.sales_value / sum(a.sales_value) over (), 4) end,
         case when a.days_with_sales = 0 then 0 else round(a.pieces::numeric / a.days_with_sales, 2) end,
         case when a.days_with_sales = 0 then 0 else round(a.sales_value / a.days_with_sales, 2) end,
         case when a.sales_value = 0 then null
              else (rank() over (order by a.sales_value desc))::int end,
         a.low_value_days,
         a.rs10_pieces, a.g50_pieces, a.g100_pieces,
         a.rs10_value, a.g50_value, a.g100_value
    from agg a
   order by a.sales_value desc, a.full_name
$$;

-- ───────────────────────── Dashboard: date-wise series ─────────────────────────
-- Every date in range (zeros included), for the filtered set of sellers.
create or replace function public.report_daily_series(
  p_from   date,
  p_to     date,
  p_region smallint default null,
  p_seller uuid     default null
) returns table (report_date date, sellers_reported int, pieces bigint, sales_value numeric)
language sql stable security invoker set search_path = public as $$
  select g.d::date,
         count(t.report_id)::int,
         coalesce(sum(t.pieces), 0)::bigint,
         coalesce(sum(t.sales_value), 0)
    from generate_series(p_from, p_to, interval '1 day') g(d)
    left join v_daily_seller_totals t
           on t.report_date = g.d::date
          and (p_region is null or t.region_id = p_region)
          and (p_seller is null or t.seller_id = p_seller)
   group by g.d
   order by g.d
$$;

-- ───────────────────────── Dashboard: product / SKU breakdown ─────────────────────────
create or replace function public.report_sku_summary(
  p_from   date,
  p_to     date,
  p_region smallint default null,
  p_seller uuid     default null
) returns table (product_name text, sku_code text, pack_size public.pack_size, pieces bigint, sales_value numeric)
language sql stable security invoker set search_path = public as $$
  select pr.name, s.code, s.pack_size,
         coalesce(sum(v.quantity), 0)::bigint,
         coalesce(sum(v.line_value), 0)
    from skus s
    join products pr on pr.id = s.product_id
    left join v_sales_lines v
           on v.sku_id = s.id
          and v.report_date between p_from and p_to
          and (p_region is null or v.region_id = p_region)
          and (p_seller is null or v.seller_id = p_seller)
   group by pr.name, pr.sort_order, s.code, s.pack_size, s.sort_order
   order by pr.sort_order, s.sort_order
$$;

-- ───────────────────────── Ops: who hasn't submitted ─────────────────────────
create or replace function public.report_missing_submissions(
  p_date   date     default null,
  p_region smallint default null
) returns table (seller_id uuid, seller_name text, phone text, region_name text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.full_name, p.phone, g.name
    from profiles p
    join regions g on g.id = p.region_id
   where p.role = 'seller' and p.is_active
     and (p_region is null or p.region_id = p_region)
     and not exists (select 1 from daily_reports r
                      where r.seller_id = p.id
                        and r.report_date = coalesce(p_date, today_local()))
   order by g.name, p.full_name
$$;

-- ───────────────────────── Excel-style grid: SKU × day for one seller-month ─────────────────────────
create or replace function public.report_seller_month_grid(p_seller uuid, p_month date)
returns table (product_name text, sku_code text, pack_size public.pack_size, mrp numeric, retailer_basic_cost numeric,
               day int, quantity int)
language sql stable security invoker set search_path = public as $$
  select v.product_name, v.sku_code, v.pack_size, v.unit_mrp, v.unit_rbc,
         extract(day from v.report_date)::int, v.quantity
    from v_sales_lines v
   where v.seller_id = p_seller
     and v.report_date >= date_trunc('month', p_month)::date
     and v.report_date <  (date_trunc('month', p_month) + interval '1 month')::date
   order by v.product_name, v.pack_size, v.report_date
$$;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke all on public.v_sales_lines, public.v_daily_seller_totals from anon;
grant select on public.v_sales_lines, public.v_daily_seller_totals to authenticated;
