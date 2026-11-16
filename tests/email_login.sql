\set ON_ERROR_STOP 1
begin;
do $$
declare seller uuid; old_login uuid := gen_random_uuid(); new_login uuid := gen_random_uuid();
begin
  select id into strict seller from public.profiles where full_name = 'Govind';
  if exists (select 1 from public.profiles where auth_user_id is not null) then
    raise exception 'Phone links were not cleared during migration';
  end if;
  update public.profiles set email = ' Govind@Example.com ' where id = seller;
  if not public.email_allowed(' GOVIND@example.com ') then
    raise exception 'Active normalized email must be allowed';
  end if;
  insert into auth.users(id, email) values (old_login, 'govind@example.com');
  if exists (select 1 from public.profiles where id = seller and auth_user_id is not null) then
    raise exception 'Unverified email claimed profile';
  end if;
  update auth.users set email_confirmed_at = now() where id = old_login;
  if not exists (select 1 from public.profiles where id = seller and auth_user_id = old_login) then
    raise exception 'Confirmed email did not link';
  end if;
  update public.profiles set phone = '919000000001' where id = seller;
  if not exists (select 1 from public.profiles where id = seller and auth_user_id = old_login) then
    raise exception 'Contact phone edit changed login';
  end if;
  update public.profiles set email = 'new-govind@example.com' where id = seller;
  if exists (select 1 from public.profiles where id = seller and auth_user_id is not null) then
    raise exception 'Old email retained access';
  end if;
  insert into auth.users(id, email, email_confirmed_at)
    values (new_login, 'new-govind@example.com', now());
  if not exists (select 1 from public.profiles where id = seller and auth_user_id = new_login) then
    raise exception 'New confirmed email did not link';
  end if;
  update auth.users set email = 'changed@example.com' where id = new_login;
  if exists (select 1 from public.profiles where id = seller and auth_user_id is not null) then
    raise exception 'Auth email change retained old profile';
  end if;
  update public.profiles set email = 'changed@example.com' where id = seller;
  if not exists (select 1 from public.profiles where id = seller and auth_user_id = new_login) then
    raise exception 'Existing confirmed account did not link';
  end if;
  update public.profiles set is_active = false where id = seller;
  if public.email_allowed('changed@example.com') or public.email_allowed('unknown@example.com') then
    raise exception 'Inactive or unknown account allowed';
  end if;
end $$;
rollback;