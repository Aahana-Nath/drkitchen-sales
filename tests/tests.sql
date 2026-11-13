\set ON_ERROR_STOP 1
-- setup as postgres: phones, auth users, managers
update profiles set phone='919000000001' where full_name='Govind';
update profiles set phone='919000000002' where full_name='Naveen';
update profiles set phone='919000000011' where full_name='Ashish';
update profiles set phone='919000000099' where role='superadmin';
insert into profiles (full_name, phone, role, region_id) select 'Delhi RM','919000000050','regional_manager',id from regions where code='DELHI';
insert into profiles (full_name, phone, role, region_id) select 'East RM','919000000051','regional_manager',id from regions where code='EAST_UP';
insert into auth.users (id, phone) values
 ('00000000-0000-0000-0000-000000000001','919000000001'),('00000000-0000-0000-0000-000000000002','919000000002'),
 ('00000000-0000-0000-0000-000000000011','919000000011'),('00000000-0000-0000-0000-000000000099','919000000099'),
 ('00000000-0000-0000-0000-000000000050','919000000050'),('00000000-0000-0000-0000-000000000051','919000000051'),
 ('00000000-0000-0000-0000-0000000000ff','919999999999');  -- unknown phone
select 'linked profiles' t, count(*) from profiles where auth_user_id is not null;

create function expect_fail(q text, label text) returns text language plpgsql as $$
begin execute q; return 'FAIL (no error): '||label;
exception when others then return 'ok blocked: '||label||' -> '||left(sqlerrm,70); end $$;
grant execute on function expect_fail(text,text) to authenticated;

-- ── Govind (Delhi seller) ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select my_role(), (select name from regions where id=my_region()) region;
select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":10},{"sku_code":"TUR-P-100","quantity":1},{"sku_code":"KM-S-50","quantity":0}]', 'first day') is not null as govind_saved_today;
select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":12},{"sku_code":"AJW-S-100","quantity":2}]') is not null as govind_edited_today;
select sku_code, quantity, unit_rbc, line_value from v_sales_lines order by sku_code;
select expect_fail($$select save_daily_report(today_local()-5, '[{"sku_code":"TUR-P-10","quantity":1}]')$$, 'seller back-dating 5 days');
select expect_fail($$select save_daily_report(today_local()+1, '[{"sku_code":"TUR-P-10","quantity":1}]')$$, 'future date');
select expect_fail($$select save_daily_report(today_local(), '[{"sku_code":"NOPE","quantity":1}]')$$, 'unknown sku');
select expect_fail($$select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":-3}]')$$, 'negative qty');
select expect_fail($$select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":1}]', null, 'NAVEEN_ID')$$, 'seller filing for another seller');
select expect_fail($$update profiles set role='superadmin' where full_name='Govind'$$, 'self-promote');
select count(*) as govind_rows_after_promote_attempt from profiles where role='superadmin';
select 'govind sees profiles' t, count(*) from profiles;
select expect_fail($$delete from daily_reports$$, 'seller delete');
select 'govind reports visible' t, count(*) from daily_reports;
reset role;

-- yesterday-before-cutoff check uses clock; compute expectation
select 'yesterday editable now?' t, seller_can_edit(today_local()-1), extract(hour from now() at time zone 'Asia/Kolkata') hr;

-- ── Naveen (Delhi seller) zero-sale day ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":0}]', 'market closed') is not null as naveen_zero_day;
select 'naveen sees reports' t, count(*) from daily_reports;
select 'naveen sees lines' t, count(*) from v_sales_lines;
reset role;

-- ── Ashish (East seller) ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":40},{"sku_code":"TUR-P-100","quantity":4}]') is not null as ashish_saved;
reset role;

-- ── Delhi RM ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000050';
select 'delhi rm sees reports' t, string_agg(seller_name, ', ' order by seller_name) from v_daily_seller_totals;
select save_daily_report(today_local()-5, '[{"sku_code":"COR-P-50","quantity":7}]', 'entered by RM', (select id from profiles where full_name='Umesh Kumar')) is not null as rm_backfill_own_region;
select expect_fail($$select save_daily_report(today_local(), '[{"sku_code":"TUR-P-10","quantity":1}]', null, 'ASHISH_ID')$$, 'RM editing other region');
select expect_fail($$update daily_report_lines set quantity=999 where report_id in (select id from daily_reports where seller_id=(select id from profiles where full_name='Ashish'))$$, 'RM direct update other region');
select seller_name, days_reported, days_with_sales, pieces, sales_value, value_share, rank_by_value, low_value_days from report_seller_summary(date_trunc('month', today_local())::date, today_local());
select * from report_missing_submissions();
select 'rm audit rows visible' t, count(*) from audit_log;
reset role;

-- ── Superadmin ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000099';
select seller_name, region_name, days_with_sales, pieces, sales_value, value_share, rank_by_value, rs10_pieces, g100_pieces from report_seller_summary(date_trunc('month', today_local())::date, today_local()) where pieces > 0 or days_reported > 0;
select * from report_daily_series(today_local()-6, today_local()) where sellers_reported > 0;
select region_name, count(*) missing from report_missing_submissions() group by 1;
select product_name, sku_code, pieces, sales_value from report_sku_summary(date_trunc('month', today_local())::date, today_local()) where pieces > 0;
-- price change: new price from tomorrow must not change today's values
insert into sku_prices (sku_id, effective_from, mrp, retailer_basic_cost) select id, today_local()+1, 12, round(12/1.26,6) from skus where code='TUR-P-10';
select 'ashish value unchanged after price change' t, sales_value from v_daily_seller_totals where seller_name='Ashish';
select action, table_name, count(*) from audit_log group by 1,2 order by 2,1;
reset role;

-- ── Unknown phone / anon ──
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select 'unknown user sees' t, (select count(*) from daily_reports) reports, (select count(*) from skus) skus, (select count(*) from profiles) profiles;
reset role;
set role anon;
select expect_fail($$select count(*) from daily_reports$$, 'anon read');
reset role;
