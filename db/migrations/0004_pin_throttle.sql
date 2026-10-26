-- PIN sign-in hardening, from the Sprint 6 security review.
-- 1. Spraying: the per-person lockout (5 failures) lets someone try one PIN across every person, one
--    failure each. Failures are now also counted per signed-in device account (the Neon Auth user):
--    20 failures across any people lock that account's PIN sign-in for 15 minutes.
-- 2. Races: the check and the failure count were separate statements, so parallel attempts could all pass
--    the "not locked" check. pin_gate() locks the person's row and the account's row until the transaction
--    ends, so attempts are handled one at a time.

alter table members
  add column pin_failed int not null default 0,
  add column pin_locked_until timestamptz;

-- Step 1: lock the rows and read the state. Returns nothing for an unknown, inactive or other-hotel person.
create function pin_gate(p_staff uuid, p_user text)
  returns table (pin_hash text, staff_locked_until timestamptz, user_locked_until timestamptz)
  language plpgsql security definer set search_path = '' as
$$
declare
  v_user_locked timestamptz;
begin
  select m.pin_locked_until into v_user_locked
    from public.members m
   where m.user_id = p_user and m.org_id = public.app_org()
     for update;
  return query
    select s.pin_hash, s.pin_locked_until, v_user_locked
      from public.staff s
     where s.id = p_staff and s.org_id = public.app_org() and s.active
       for update;
end
$$;

-- Step 2: record the outcome. A person locks for 2, 4, 8 ... up to 60 minutes after five failures;
-- the device account locks for 15 minutes after twenty failures across anyone.
create function pin_result(p_staff uuid, p_user text, p_ok boolean)
  returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if p_ok then
    update public.staff set pin_failed = 0, pin_locked_until = null
     where id = p_staff and org_id = public.app_org();
  else
    update public.staff
       set pin_failed = pin_failed + 1,
           pin_locked_until = case when pin_failed + 1 >= 5
             then now() + make_interval(mins => least(power(2, pin_failed + 1 - 5)::int, 60))
             else pin_locked_until end
     where id = p_staff and org_id = public.app_org();
    update public.members
       set pin_failed = case when pin_failed + 1 >= 20 then 0 else pin_failed + 1 end,
           pin_locked_until = case when pin_failed + 1 >= 20 then now() + interval '15 minutes' else pin_locked_until end
     where user_id = p_user and org_id = public.app_org();
  end if;
end
$$;

revoke all on function pin_gate(uuid, text), pin_result(uuid, text, boolean) from public;
grant execute on function pin_gate(uuid, text), pin_result(uuid, text, boolean) to app_user;
