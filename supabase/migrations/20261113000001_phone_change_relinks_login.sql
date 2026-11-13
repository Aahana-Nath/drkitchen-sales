-- When an admin changes someone's phone, the old phone's login must lose access
-- and the new phone's login (if it already exists) takes over.
create or replace function public.tg_profiles_link_auth() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.auth_user_id := null;
  end if;
  if new.auth_user_id is null and new.phone is not null then
    select id into new.auth_user_id from auth.users where phone = new.phone limit 1;
  end if;
  return new;
end $$;
