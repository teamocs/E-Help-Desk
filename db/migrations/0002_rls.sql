-- Row-level security, least-privilege grants, and the sign-in functions.
--
-- The app connects as `app_user`: no BYPASSRLS, owns nothing, cannot create objects. Each request
-- runs in a transaction that first sets the org (is_local = true so it cannot leak across pooled
-- connections):
--     select set_config('app.org_id', '<org uuid>', true);
-- With no org set, app_org() is null and every policy matches zero rows.
--
-- Migrations and seeds run as the database owner, which is exempt from these policies (policies
-- apply `to app_user`, and FORCE is deliberately not used so a non-superuser owner can still
-- migrate). Never use the owner's connection string in the app.
--
-- Login for app_user is set out of band (a password never lives in a migration):
--     alter role app_user login password '...';
--
-- Not decided yet and not enforced here: scoping staff to a single property inside an org, and
-- retention rules for incidents. Both are open questions for the pilot.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end
$$;

revoke create on schema public from public;
grant usage on schema public to app_user;

create or replace function app_org() returns uuid
  language sql stable set search_path = '' as
$$ select nullif(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;

revoke all on function app_org() from public;
grant execute on function app_org() to app_user;

-- ---------------------------------------------------------------------------------------------
-- Grants. Second wall: even a policy mistake cannot expose secrets or rewrite history.
-- ---------------------------------------------------------------------------------------------
grant select on orgs, properties, members to app_user;
grant update (ticket_seq, wo_seq, inc_seq) on properties to app_user;
-- members: read only. Invites and role changes go through a separate, owner-checked path (Sprint 5).

-- staff: everything except the PIN columns. Role is not writable by the app.
grant select (id, org_id, name, initials, role, title, dept, on_shift, active, created_at) on staff to app_user;
grant insert (org_id, name, initials, role, title, dept, on_shift) on staff to app_user;
grant update (name, initials, title, dept, on_shift, active) on staff to app_user;

-- devices: token_hash can be written once at registration but never read back.
grant select (id, org_id, property_id, label, signed_in_by, created_at, expires_at, last_seen_at, revoked_at) on devices to app_user;
grant insert (org_id, property_id, label, token_hash, signed_in_by, expires_at) on devices to app_user;
grant update (revoked_at, last_seen_at) on devices to app_user;

grant select, insert on requests, clean_tasks, items, incidents to app_user;
grant update (room, remarks, vip, incomplete, safety_id) on requests to app_user;
grant update (room, status, assignee) on clean_tasks to app_user;
grant update (name, qty, dept, assignee, status, hold_reason, ack_at, done_at, hold_since, held_ms, sla_min,
              depends_on, x_from, wo_id, st_before_esc) on items to app_user;
-- incidents: the text and creation facts never change; rooms can grow when reports are merged.
grant update (status, rooms, called911_by, called911_at) on incidents to app_user;

grant select, insert, delete on work_orders to app_user; -- escalation can be undone
grant update (area, loc, descr, priority, dept, status, assessment, assign_type, contractor, est_cost,
              actual_cost, target_end, src_item_id) on work_orders to app_user;

grant select, insert on events to app_user; -- no update, no delete

-- ---------------------------------------------------------------------------------------------
-- Policies. One tenant policy per table.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['properties', 'members', 'staff', 'devices', 'requests', 'items',
                           'work_orders', 'clean_tasks', 'incidents']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant on %I for all to app_user using (org_id = app_org()) with check (org_id = app_org())', t);
  end loop;
end
$$;

alter table orgs enable row level security;
create policy tenant on orgs for select to app_user using (id = app_org());

alter table events enable row level security;
create policy tenant_read on events for select to app_user using (org_id = app_org());
create policy tenant_write on events for insert to app_user with check (org_id = app_org());

-- A 911 call time, once recorded, cannot be changed.
create function incidents_lock_911() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if old.called911_at is not null
     and (new.called911_at is distinct from old.called911_at or new.called911_by is distinct from old.called911_by) then
    raise exception 'The 911 call is already recorded for this incident';
  end if;
  return new;
end
$$;
create trigger incidents_lock_911 before update on incidents
  for each row execute function incidents_lock_911();

-- ---------------------------------------------------------------------------------------------
-- Sign-in functions. These run before the org is known, or touch columns the app role cannot
-- see, so they are SECURITY DEFINER with an empty search_path. Each returns the minimum.
-- ---------------------------------------------------------------------------------------------

-- Which org and property does this device token belong to? Rejects revoked and expired devices.
create function device_by_token(p_token_hash text)
  returns table (device_id uuid, org_id uuid, property_id uuid)
  language sql stable security definer set search_path = '' as
$$
  select d.id, d.org_id, d.property_id
  from public.devices d
  where d.token_hash = p_token_hash
    and d.revoked_at is null
    and (d.expires_at is null or d.expires_at > now())
$$;

-- Which org does a signed-in Neon Auth user belong to?
create function member_for_user(p_user_id text)
  returns table (org_id uuid, role text)
  language sql stable security definer set search_path = '' as
$$ select m.org_id, m.role from public.members m where m.user_id = p_user_id $$;

-- First sign-in: attach the Neon Auth user to an invited member row. Only for a VERIFIED email,
-- only while unclaimed, and never re-matched afterwards. The caller must pass the email_verified
-- flag from the Neon Auth session; this function trusts it.
create function claim_membership(p_email text, p_user_id text, p_email_verified boolean)
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
     where m.email = lower(p_email) and m.user_id is null
    returning m.org_id, m.role;
end
$$;

-- PIN check, step 1: the stored hash and lockout state. The app compares the hash itself
-- (argon2id with a server-side pepper) and then reports the result.
create function staff_pin_state(p_staff uuid)
  returns table (pin_hash text, pin_failed int, pin_locked_until timestamptz)
  language sql stable security definer set search_path = '' as
$$
  select s.pin_hash, s.pin_failed, s.pin_locked_until
  from public.staff s
  where s.id = p_staff and s.org_id = public.app_org() and s.active
$$;

-- PIN check, step 2: record the outcome. Staff lock for 2, 4, 8 ... up to 60 minutes after five
-- failures. A device locks for 15 minutes after ten failures across any staff, which stops one PIN
-- being sprayed across everyone.
create function record_pin_attempt(p_staff uuid, p_device uuid, p_ok boolean)
  returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_ok then
    update public.staff set pin_failed = 0, pin_locked_until = null
     where id = p_staff and org_id = public.app_org();
    update public.devices set pin_failed = 0, pin_locked_until = null
     where id = p_device and org_id = public.app_org();
  else
    update public.staff
       set pin_failed = pin_failed + 1,
           pin_locked_until = case when pin_failed + 1 >= 5
             then now() + make_interval(mins => least(power(2, pin_failed + 1 - 5)::int, 60))
             else pin_locked_until end
     where id = p_staff and org_id = public.app_org();
    update public.devices
       set pin_failed = pin_failed + 1,
           pin_locked_until = case when pin_failed + 1 >= 10
             then now() + interval '15 minutes' else pin_locked_until end
     where id = p_device and org_id = public.app_org();
  end if;
end
$$;

-- Set or reset a PIN. The server action must check that the caller is a manager or owner.
create function set_staff_pin(p_staff uuid, p_hash text)
  returns void
  language sql security definer set search_path = '' as
$$
  update public.staff set pin_hash = p_hash, pin_failed = 0, pin_locked_until = null
   where id = p_staff and org_id = public.app_org()
$$;

revoke all on function device_by_token(text), member_for_user(text), claim_membership(text, text, boolean),
  staff_pin_state(uuid), record_pin_attempt(uuid, uuid, boolean), set_staff_pin(uuid, text) from public;
grant execute on function device_by_token(text), member_for_user(text), claim_membership(text, text, boolean),
  staff_pin_state(uuid), record_pin_attempt(uuid, uuid, boolean), set_staff_pin(uuid, text) to app_user;
