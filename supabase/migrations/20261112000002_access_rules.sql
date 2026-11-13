-- DrKitchen Sales — row-level access rules
--   seller            : own reports only; can file/edit today, and yesterday until cutoff
--   regional_manager  : read + correct all reports in own region
--   superadmin        : everything, incl. users, regions, SKUs, prices, settings

-- Report-level checks used by line policies
create or replace function public.can_read_report(p_report bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from daily_reports r
     where r.id = p_report
       and (   r.seller_id = my_profile_id()
            or my_role() = 'superadmin'
            or (my_role() = 'regional_manager' and r.region_id = my_region()))
  )
$$;

create or replace function public.can_write_report(p_report bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from daily_reports r
     where r.id = p_report
       and (   (my_role() = 'seller' and r.seller_id = my_profile_id() and seller_can_edit(r.report_date))
            or my_role() = 'superadmin'
            or (my_role() = 'regional_manager' and r.region_id = my_region()))
  )
$$;

alter table public.app_settings       enable row level security;
alter table public.regions            enable row level security;
alter table public.profiles           enable row level security;
alter table public.products           enable row level security;
alter table public.skus               enable row level security;
alter table public.sku_prices         enable row level security;
alter table public.daily_reports      enable row level security;
alter table public.daily_report_lines enable row level security;
alter table public.audit_log          enable row level security;

-- ── Master data: any active user reads; superadmin writes ──
create policy settings_read  on public.app_settings for select to authenticated using (my_role() is not null);
create policy settings_admin on public.app_settings for all    to authenticated using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy regions_read  on public.regions for select to authenticated using (my_role() is not null);
create policy regions_admin on public.regions for all    to authenticated using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy products_read  on public.products for select to authenticated using (my_role() is not null);
create policy products_admin on public.products for all    to authenticated using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy skus_read  on public.skus for select to authenticated using (my_role() is not null);
create policy skus_admin on public.skus for all    to authenticated using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

create policy prices_read  on public.sku_prices for select to authenticated using (my_role() is not null);
create policy prices_admin on public.sku_prices for all    to authenticated using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- ── Profiles ──
create policy profiles_read on public.profiles for select to authenticated using (
     id = my_profile_id()
  or my_role() = 'superadmin'
  or (my_role() = 'regional_manager' and region_id = my_region())
);
create policy profiles_admin on public.profiles for all to authenticated
  using (my_role() = 'superadmin') with check (my_role() = 'superadmin');

-- ── Daily reports ──
create policy reports_read on public.daily_reports for select to authenticated using (
     seller_id = my_profile_id()
  or my_role() = 'superadmin'
  or (my_role() = 'regional_manager' and region_id = my_region())
);

-- WITH CHECK runs after the BEFORE trigger has stamped region_id
create policy reports_insert on public.daily_reports for insert to authenticated with check (
     (my_role() = 'seller' and seller_id = my_profile_id() and seller_can_edit(report_date))
  or my_role() = 'superadmin'
  or (my_role() = 'regional_manager' and region_id = my_region())
);

create policy reports_update on public.daily_reports for update to authenticated
  using (
       (my_role() = 'seller' and seller_id = my_profile_id() and seller_can_edit(report_date))
    or my_role() = 'superadmin'
    or (my_role() = 'regional_manager' and region_id = my_region()))
  with check (
       (my_role() = 'seller' and seller_id = my_profile_id() and seller_can_edit(report_date))
    or my_role() = 'superadmin'
    or (my_role() = 'regional_manager' and region_id = my_region()));

create policy reports_delete on public.daily_reports for delete to authenticated
  using (my_role() = 'superadmin');

-- ── Report lines ──
create policy lines_read   on public.daily_report_lines for select to authenticated using (can_read_report(report_id));
create policy lines_insert on public.daily_report_lines for insert to authenticated with check (can_write_report(report_id));
create policy lines_update on public.daily_report_lines for update to authenticated
  using (can_write_report(report_id)) with check (can_write_report(report_id));
create policy lines_delete on public.daily_report_lines for delete to authenticated using (can_write_report(report_id));

-- ── Audit log: read-only; written by triggers only ──
create policy audit_read on public.audit_log for select to authenticated using (
     my_role() = 'superadmin'
  or (my_role() = 'regional_manager' and region_id = my_region())
);

-- ── Grants: nothing for anonymous users ──
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete on public.audit_log from authenticated;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
