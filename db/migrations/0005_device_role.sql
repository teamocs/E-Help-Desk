-- Restricted device accounts. A shared phone signs in with its own account (role 'device'), invited by an
-- owner. It can open the desk and run staff PIN sign-in, but it cannot manage staff or invite anyone, and
-- the server refuses its commands until a staff member has signed in with a PIN. Owners and managers keep
-- using their own accounts on their own phones, so the shared phone never holds a manager session.

alter table members drop constraint members_role_check;
alter table members add constraint members_role_check check (role in ('owner', 'manager', 'device'));

-- The owner can now invite either a manager or a device account.
create or replace function invite_member(p_org uuid, p_actor text, p_email text, p_role text)
  returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_org is distinct from public.app_org()
     or not exists (select 1 from public.members m where m.org_id = p_org and m.user_id = p_actor and m.role = 'owner') then
    raise exception 'Only an owner can invite people';
  end if;
  if p_role is null or p_role not in ('manager', 'device') then
    raise exception 'Only the manager or device role can be invited';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if (select count(*) from public.members m where m.org_id = p_org) >= 50 then
    raise exception 'This hotel has reached its limit of 50 people';
  end if;
  insert into public.members (org_id, email, role) values (p_org, v_email, p_role) on conflict do nothing;
  if not found then
    raise exception 'That email is already invited or a member';
  end if;
end
$$;
