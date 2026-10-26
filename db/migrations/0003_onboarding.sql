-- Self-serve onboarding. A verified user can create a hotel and becomes its owner; an owner can invite
-- and revoke managers. The app role still has no write access to members: every change goes through
-- these functions, which are SECURITY DEFINER with an empty search_path and check the caller themselves.
-- The caller's user id must come from the Neon Auth session on the server, never from the browser.

-- A user belongs to one hotel. The app resolves a single org per signed-in user.
create unique index members_one_hotel_per_user on members (user_id) where user_id is not null;

-- Claim ONE pending invite per sign-in (the oldest). The first version claimed every row for the email,
-- which would break once the same address is invited to two hotels.
create or replace function claim_membership(p_email text, p_user_id text, p_email_verified boolean)
  returns table (org_id uuid, role text)
  language plpgsql security definer set search_path = '' as
$$
begin
  if not p_email_verified then
    return;
  end if;
  return query
    update public.members m
       set user_id = p_user_id, claimed_at = now()
     where m.user_id is null
       and m.email = lower(btrim(p_email))
       and (m.org_id, m.email) = (
         select x.org_id, x.email from public.members x
          where x.user_id is null and x.email = lower(btrim(p_email))
          order by x.created_at, x.org_id
          limit 1)
    returning m.org_id, m.role;
end
$$;

-- Create a hotel with its first property; the caller becomes the owner.
create function create_org(p_user_id text, p_email text, p_email_verified boolean, p_org_name text, p_property_name text)
  returns table (org_id uuid, property_id uuid)
  language plpgsql security definer set search_path = '' as
$$
declare
  v_org uuid;
  v_prop uuid;
  v_org_name text := btrim(coalesce(p_org_name, ''));
  v_prop_name text := btrim(coalesce(p_property_name, ''));
begin
  if not p_email_verified then
    raise exception 'Verify your email first';
  end if;
  if coalesce(p_user_id, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.members m where m.user_id = p_user_id) then
    raise exception 'You already belong to a hotel';
  end if;
  if char_length(v_org_name) not between 1 and 80 or char_length(v_prop_name) not between 1 and 80 then
    raise exception 'Enter a hotel name and a property name of up to 80 characters';
  end if;
  -- Sign-up is open, so cap how fast new hotels can appear across the whole service.
  if (select count(*) from public.orgs o where o.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many new hotels right now. Try again later';
  end if;
  insert into public.orgs (name) values (v_org_name) returning id into v_org;
  insert into public.properties (org_id, name) values (v_org, v_prop_name) returning id into v_prop;
  insert into public.members (org_id, email, user_id, role, claimed_at)
    values (v_org, lower(btrim(p_email)), p_user_id, 'owner', now());
  return query select v_org, v_prop;
end
$$;

-- Invite a manager. Only an owner of that hotel can.
create function invite_member(p_org uuid, p_actor text, p_email text, p_role text)
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
  if p_role is distinct from 'manager' then
    raise exception 'Only the manager role can be invited';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if (select count(*) from public.members m where m.org_id = p_org) >= 50 then
    raise exception 'This hotel has reached its limit of 50 people';
  end if;
  insert into public.members (org_id, email, role) values (p_org, v_email, 'manager') on conflict do nothing;
  if not found then
    raise exception 'That email is already invited or a member';
  end if;
end
$$;

-- Withdraw an invite nobody has claimed yet. A claimed membership is left alone.
create function revoke_invite(p_org uuid, p_actor text, p_email text)
  returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_org is distinct from public.app_org()
     or not exists (select 1 from public.members m where m.org_id = p_org and m.user_id = p_actor and m.role = 'owner') then
    raise exception 'Only an owner can revoke invites';
  end if;
  delete from public.members m
   where m.org_id = p_org and m.email = lower(btrim(coalesce(p_email, ''))) and m.user_id is null;
end
$$;

-- A manager can leave a hotel they were invited to, so an unwanted invite never traps anyone. An owner
-- cannot leave: the hotel would have nobody in charge.
create function leave_org(p_user_id text)
  returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if exists (select 1 from public.members m where m.user_id = p_user_id and m.role = 'owner') then
    raise exception 'An owner cannot leave their hotel';
  end if;
  delete from public.members m where m.user_id = p_user_id and m.role = 'manager';
end
$$;

revoke all on function create_org(text, text, boolean, text, text), invite_member(uuid, text, text, text),
  revoke_invite(uuid, text, text), leave_org(text) from public;
grant execute on function create_org(text, text, boolean, text, text), invite_member(uuid, text, text, text),
  revoke_invite(uuid, text, text), leave_org(text) to app_user;
