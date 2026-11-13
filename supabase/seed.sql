-- DrKitchen Sales — seed data (generated from Delhi/East UP DSR November 2026 workbooks)

insert into public.app_settings (key, value) values
  ('timezone', '"Asia/Kolkata"'),
  ('seller_edit_cutoff_hour', '12'),
  ('low_day_threshold', '7500'),
  ('mrp_to_basic_cost_factor', '1.26');

insert into public.regions (code, name) values
  ('DELHI', 'Delhi'),
  ('EAST_UP', 'East UP & Ghaziabad');

insert into public.products (code, name, sort_order) values
  ('TUR-P', 'Turmeric Powder', 10),
  ('RCH-P', 'Red Chilli Powder', 20),
  ('COR-P', 'Coriander Powder', 30),
  ('GRM-B', 'Garam Masala Powder', 40),
  ('KK-B', 'Kitchen King Masala', 50),
  ('JR-S', 'Cumin Seeds', 60),
  ('JR-P', 'Cumin Powder', 70),
  ('MET-S', 'Methi Dana', 80),
  ('SAR-S', 'Black Mustard Seeds', 90),
  ('YM-S', 'Yellow Mustard Seeds', 100),
  ('KM-S', 'Whole Black Pepper', 110),
  ('AJW-S', 'Ajwain', 120);

insert into public.skus (product_id, pack_size, code, sort_order)
select p.id, v.pack::public.pack_size, v.code, v.ord from (values
  ('TUR-P', 'rs10', 'TUR-P-10', 1),
  ('TUR-P', 'g50', 'TUR-P-50', 2),
  ('TUR-P', 'g100', 'TUR-P-100', 3),
  ('RCH-P', 'rs10', 'RCH-P-10', 1),
  ('RCH-P', 'g50', 'RCH-P-50', 2),
  ('RCH-P', 'g100', 'RCH-P-100', 3),
  ('COR-P', 'rs10', 'COR-P-10', 1),
  ('COR-P', 'g50', 'COR-P-50', 2),
  ('COR-P', 'g100', 'COR-P-100', 3),
  ('GRM-B', 'rs10', 'GRM-B-10', 1),
  ('GRM-B', 'g50', 'GRM-B-50', 2),
  ('GRM-B', 'g100', 'GRM-B-100', 3),
  ('KK-B', 'rs10', 'KK-B-10', 1),
  ('KK-B', 'g50', 'KK-B-50', 2),
  ('KK-B', 'g100', 'KK-B-100', 3),
  ('JR-S', 'rs10', 'JR-S-10', 1),
  ('JR-S', 'g50', 'JR-S-50', 2),
  ('JR-S', 'g100', 'JR-S-100', 3),
  ('JR-P', 'rs10', 'JR-P-10', 1),
  ('JR-P', 'g50', 'JR-P-50', 2),
  ('JR-P', 'g100', 'JR-P-100', 3),
  ('MET-S', 'rs10', 'MET-S-10', 1),
  ('MET-S', 'g50', 'MET-S-50', 2),
  ('MET-S', 'g100', 'MET-S-100', 3),
  ('SAR-S', 'rs10', 'SAR-S-10', 1),
  ('SAR-S', 'g50', 'SAR-S-50', 2),
  ('SAR-S', 'g100', 'SAR-S-100', 3),
  ('YM-S', 'rs10', 'YM-S-10', 1),
  ('YM-S', 'g50', 'YM-S-50', 2),
  ('YM-S', 'g100', 'YM-S-100', 3),
  ('KM-S', 'rs10', 'KM-S-10', 1),
  ('KM-S', 'g50', 'KM-S-50', 2),
  ('KM-S', 'g100', 'KM-S-100', 3),
  ('AJW-S', 'rs10', 'AJW-S-10', 1),
  ('AJW-S', 'g50', 'AJW-S-50', 2),
  ('AJW-S', 'g100', 'AJW-S-100', 3)
) v(pcode, pack, code, ord) join public.products p on p.code = v.pcode;

-- Prices in force from 1 Nov 2026. Retailer basic cost = MRP / 1.26 (as in the workbooks).
insert into public.sku_prices (sku_id, effective_from, mrp, retailer_basic_cost)
select s.id, date '2026-11-01', v.mrp, round(v.mrp / 1.26, 6) from (values
  ('TUR-P-10', 10),
  ('TUR-P-50', 25),
  ('TUR-P-100', 46),
  ('RCH-P-10', 10),
  ('RCH-P-50', 35),
  ('RCH-P-100', 65),
  ('COR-P-10', 10),
  ('COR-P-50', 24),
  ('COR-P-100', 42),
  ('GRM-B-10', 10),
  ('GRM-B-50', 55),
  ('GRM-B-100', 106),
  ('KK-B-10', 10),
  ('KK-B-50', 50),
  ('KK-B-100', 96),
  ('JR-S-10', 10),
  ('JR-S-50', 35),
  ('JR-S-100', 66),
  ('JR-P-10', 10),
  ('JR-P-50', 50),
  ('JR-P-100', 96),
  ('MET-S-10', 10),
  ('MET-S-50', 20),
  ('MET-S-100', 36),
  ('SAR-S-10', 10),
  ('SAR-S-50', 20),
  ('SAR-S-100', 36),
  ('YM-S-10', 10),
  ('YM-S-50', 20),
  ('YM-S-100', 36),
  ('KM-S-10', 10),
  ('KM-S-50', 95),
  ('KM-S-100', 180),
  ('AJW-S-10', 10),
  ('AJW-S-50', 30),
  ('AJW-S-100', 56)
) v(code, mrp) join public.skus s on s.code = v.code;

-- Sellers from the workbooks. Phones are blank: fill them in before they can log in.
insert into public.profiles (full_name, role, region_id)
select v.name, 'seller', r.id from (values
  ('Govind', 'DELHI'),
  ('Naveen', 'DELHI'),
  ('Jaspal Singh', 'DELHI'),
  ('Umesh Kumar', 'DELHI'),
  ('Ravi Kumar', 'EAST_UP'),
  ('Jai Pal Singh', 'EAST_UP'),
  ('Vaibhav Aggarwal', 'EAST_UP'),
  ('Ashish', 'EAST_UP'),
  ('Aman', 'EAST_UP'),
  ('Vishal Barua', 'EAST_UP'),
  ('Mayank Garg', 'EAST_UP'),
  ('Kailash Pandey', 'EAST_UP')
) v(name, rcode) join public.regions r on r.code = v.rcode;

-- Superadmin. Set the real phone (digits with country code, no '+') before first login:
--   update public.profiles set phone = '91XXXXXXXXXX' where role = 'superadmin';
insert into public.profiles (full_name, role) values ('Superadmin', 'superadmin');
