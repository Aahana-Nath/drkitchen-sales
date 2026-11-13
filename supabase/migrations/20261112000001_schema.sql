-- DrKitchen Sales — core schema
-- Separate Supabase project. Roles: seller, regional_manager, superadmin.

-- ───────────────────────── Types ─────────────────────────
create type public.app_role  as enum ('seller', 'regional_manager', 'superadmin');
create type public.pack_size as enum ('rs10', 'g50', 'g100');

-- ───────────────────────── Settings ─────────────────────────
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Master data ─────────────────────────
create table public.regions (
  id         smallint generated always as identity primary key,
  code       text not null unique check (code ~ '^[A-Z0-9_]{2,20}$'),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name    text not null check (length(trim(full_name)) > 0),
  -- Supabase stores phones as digits with country code, no '+', e.g. 919876543210
  phone        text unique check (phone ~ '^[1-9][0-9]{9,14}$'),
  role         public.app_role not null default 'seller',
  region_id    smallint references public.regions(id),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_region_required check (role = 'superadmin' or region_id is not null)
);
create index profiles_region_idx on public.profiles (region_id) where is_active;

create table public.products (
  id         smallint generated always as identity primary key,
  code       text not null unique,            -- e.g. TUR-P
  name       text not null unique,            -- e.g. Turmeric Powder
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table public.skus (
  id         smallint generated always as identity primary key,
  product_id smallint not null references public.products(id),
  pack_size  public.pack_size not null,
  code       text not null unique,            -- e.g. TUR-P-50
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  unique (product_id, pack_size)
);

-- Price history. The price in force on a sale date is snapshotted onto each sale line,
-- so later price changes never rewrite past sales.
create table public.sku_prices (
  id                  bigint generated always as identity primary key,
  sku_id              smallint not null references public.skus(id),
  effective_from      date not null,
  mrp                 numeric(10,2) not null check (mrp > 0),
  retailer_basic_cost numeric(14,6) not null check (retailer_basic_cost > 0),
  created_at          timestamptz not null default now(),
  unique (sku_id, effective_from)
);

-- ───────────────────────── Sales ─────────────────────────
-- One report per seller per day (header). A submitted report with no lines = zero-sale day.
create table public.daily_reports (
  id           bigint generated always as identity primary key,
  seller_id    uuid not null references public.profiles(id) on delete restrict,
  region_id    smallint not null references public.regions(id),   -- seller's region at time of entry
  report_date  date not null,
  remarks      text,
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  unique (seller_id, report_date)
);
create index daily_reports_date_idx        on public.daily_reports (report_date);
create index daily_reports_region_date_idx on public.daily_reports (region_id, report_date);

create table public.daily_report_lines (
  id         bigint generated always as identity primary key,
  report_id  bigint not null references public.daily_reports(id) on delete cascade,
  sku_id     smallint not null references public.skus(id),
  quantity   integer not null check (quantity between 0 and 100000),
  unit_mrp   numeric(10,2) not null,
  unit_rbc   numeric(14,6) not null,
  line_value numeric(14,2) generated always as (round(quantity * unit_rbc, 2)) stored,
  updated_at timestamptz not null default now(),
  unique (report_id, sku_id)
);
create index daily_report_lines_sku_idx on public.daily_report_lines (sku_id);

-- ───────────────────────── Audit ─────────────────────────
create table public.audit_log (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  row_id           text not null,
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_profile_id uuid,
  region_id        smallint,
  old_data         jsonb,
  new_data         jsonb,
  at               timestamptz not null default now()
);
create index audit_log_at_idx     on public.audit_log (at desc);
create index audit_log_region_idx on public.audit_log (region_id, at desc);

-- ───────────────────────── Helper functions ─────────────────────────
create or replace function public.app_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from app_settings where key = 'timezone'), 'Asia/Kolkata')
$$;

create or replace function public.today_local() returns date
language sql stable as $$
  select (now() at time zone public.app_tz())::date
$$;

-- Caller identity (security definer so RLS policies can call them without recursion)
create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.my_region() returns smallint
language sql stable security definer set search_path = public as $$
  select region_id from profiles where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.profile_region(p_profile uuid) returns smallint
language sql stable security definer set search_path = public as $$
  select region_id from profiles where id = p_profile
$$;

-- Sellers may edit today's report, and yesterday's until the cutoff hour (local time).
create or replace function public.seller_can_edit(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_date = today_local()
      or (p_date = today_local() - 1
          and extract(hour from now() at time zone app_tz())
              < coalesce((select (value #>> '{}')::int from app_settings where key = 'seller_edit_cutoff_hour'), 12))
$$;

-- ───────────────────────── Triggers ─────────────────────────
create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

-- Link a profile to an auth user by phone, whichever is created first.
create or replace function public.tg_profiles_link_auth() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is null and new.phone is not null then
    select id into new.auth_user_id from auth.users where phone = new.phone limit 1;
  end if;
  return new;
end $$;

create trigger profiles_link_auth before insert or update of phone on public.profiles
  for each row execute function public.tg_profiles_link_auth();

create or replace function public.tg_auth_user_link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null then
    update profiles set auth_user_id = new.id
     where phone = new.phone and auth_user_id is null;
  end if;
  return new;
end $$;

create trigger on_auth_user_link_profile after insert or update of phone on auth.users
  for each row execute function public.tg_auth_user_link_profile();

-- Report header: stamp region from seller, block future dates and identity changes.
create or replace function public.tg_daily_reports_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role   app_role;
  v_region smallint;
  v_active boolean;
begin
  if tg_op = 'INSERT' then
    select role, region_id, is_active into v_role, v_region, v_active
      from profiles where id = new.seller_id;
    if v_role is distinct from 'seller' then
      raise exception 'Reports can only be filed for sellers';
    end if;
    if not v_active then
      raise exception 'Seller is inactive';
    end if;
    new.region_id    := v_region;
    new.submitted_at := now();
  else
    if new.seller_id <> old.seller_id or new.report_date <> old.report_date or new.region_id <> old.region_id then
      raise exception 'seller, date and region of a report cannot be changed';
    end if;
  end if;

  if new.report_date > today_local() then
    raise exception 'Cannot file sales for a future date (%)', new.report_date;
  end if;

  new.updated_at := now();
  new.updated_by := my_profile_id();
  return new;
end $$;

create trigger daily_reports_before before insert or update on public.daily_reports
  for each row execute function public.tg_daily_reports_before();

-- Lines: snapshot the price in force on the report date; keep it on quantity edits.
create or replace function public.tg_daily_report_lines_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_date date;
begin
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then
    raise exception 'A line cannot be moved to another report';
  end if;

  if tg_op = 'INSERT' or new.sku_id <> old.sku_id then
    select report_date into v_date from daily_reports where id = new.report_id;
    select p.mrp, p.retailer_basic_cost into new.unit_mrp, new.unit_rbc
      from sku_prices p
     where p.sku_id = new.sku_id and p.effective_from <= v_date
     order by p.effective_from desc
     limit 1;
    if new.unit_rbc is null then
      raise exception 'No price set for sku % on %', new.sku_id, v_date;
    end if;
  else
    new.unit_mrp := old.unit_mrp;
    new.unit_rbc := old.unit_rbc;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger daily_report_lines_before before insert or update on public.daily_report_lines
  for each row execute function public.tg_daily_report_lines_before();

-- Audit trail for sales and user changes.
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_region smallint;
begin
  if tg_table_name = 'daily_reports' or tg_table_name = 'profiles' then
    v_region := (v_row ->> 'region_id')::smallint;
  elsif tg_table_name = 'daily_report_lines' then
    select region_id into v_region from daily_reports where id = (v_row ->> 'report_id')::bigint;
  end if;

  insert into audit_log (table_name, row_id, action, actor_profile_id, region_id, old_data, new_data)
  values (tg_table_name, v_row ->> 'id', tg_op, my_profile_id(), v_region,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_daily_reports after insert or update or delete on public.daily_reports
  for each row execute function public.tg_audit();
create trigger audit_daily_report_lines after insert or update or delete on public.daily_report_lines
  for each row execute function public.tg_audit();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.tg_audit();
