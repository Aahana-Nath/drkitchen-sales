-- Email is now the sole login identity; phone is contact information only.
alter table public.profiles add column email text;
alter table public.profiles add constraint profiles_email_format
  check (email is null or (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
create unique index profiles_email_key on public.profiles (email);

create or replace function public.tg_profiles_link_auth() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := nullif(lower(trim(new.email)), '');
  new.auth_user_id := null;
  if new.email is not null then
    select id into new.auth_user_id from auth.users
     where lower(email) = new.email and email_confirmed_at is not null
     order by created_at, id limit 1;
  end if;
  return new;
end $$;

drop trigger profiles_link_auth on public.profiles;
create trigger profiles_link_auth before insert or update of email, auth_user_id on public.profiles
  for each row execute function public.tg_profiles_link_auth();

create or replace function public.tg_auth_user_link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set auth_user_id = null
   where auth_user_id = new.id
     and (new.email_confirmed_at is null or email is distinct from lower(new.email));
  if new.email is not null and new.email_confirmed_at is not null then
    update public.profiles set auth_user_id = new.id
     where email = lower(new.email) and auth_user_id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger on_auth_user_link_profile on auth.users;
create trigger on_auth_user_link_profile after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.tg_auth_user_link_profile();

-- Existing phone-only sessions must no longer map to seller/admin profiles.
update public.profiles set auth_user_id = null;

-- This is a login-screen precheck, not an Auth signup restriction.
create function public.email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where email = lower(trim(p_email)) and is_active
  )
$$;
revoke all on function public.email_allowed(text) from public;
grant execute on function public.email_allowed(text) to anon, authenticated;
