-- Invite-code gated hotel creation. Sign-up is open, so until now any verified user could create a hotel
-- (only a global cap of 20 per hour stood in the way). create_org() now also needs an invite code that
-- OCS issues with db/issue-code.mjs.
--
-- Codes: issue only long random codes (128 bits or more; issue-code.mjs makes 160-bit base32 codes).
-- Only sha256 hex of the code is stored, after removing everything but letters and digits and
-- upper-casing, so "abcd efgh" and "ABCD-EFGH" are the same code. db/signup-code.mjs hashes the same way.
--
-- Neither table is readable or writable by app_user; only the SECURITY DEFINER create_org() touches them.
--
-- Guessing: 5 wrong codes lock that signed-in user out of create_org() for 15 minutes, even for a correct
-- code. A wrong code is answered with a refusal ROW instead of an exception, because an exception would
-- roll back the failure count with everything else in the transaction. The lockout itself is raised
-- (SQLSTATE P0001) since there is nothing to keep.
--
-- Parallel safety: the caller's signup_attempts row is locked FOR UPDATE first, so one user's attempts
-- run one at a time. The code is spent with one UPDATE ... WHERE uses_left > 0 AND expires_at > now(),
-- which row-locks it; a transaction waiting on that lock re-checks the WHERE against the committed row,
-- so a single-use code cannot be spent twice. The code, org, property and owner are written in the
-- same transaction: if any step fails, the use is not spent.

create table signup_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  note text not null default '' check (char_length(note) <= 200),
  uses_left int not null check (uses_left >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_by_org uuid references orgs (id) on delete set null, -- the most recent hotel made with it
  used_at timestamptz
);

-- Wrong-code attempts per Neon Auth user. A row is removed when that user creates a hotel.
create table signup_attempts (
  user_id text primary key,
  failed int not null default 0,
  locked_until timestamptz
);

alter table signup_codes enable row level security;
alter table signup_attempts enable row level security;
revoke all on signup_codes, signup_attempts from public;
revoke all on signup_codes, signup_attempts from app_user;

drop function create_org(text, text, boolean, text, text);

-- Create a hotel with its first property; the caller becomes the owner. Returns one row: the new ids,
-- or a refusal for a wrong, used or expired code (same text for all three, so nothing is revealed).
create function create_org(p_user_id text, p_email text, p_email_verified boolean, p_org_name text,
                           p_property_name text, p_code text)
  returns table (org_id uuid, property_id uuid, refusal text)
  language plpgsql security definer set search_path = '' as
$$
declare
  v_org uuid;
  v_prop uuid;
  v_code uuid;
  v_locked timestamptz;
  v_org_name text := btrim(coalesce(p_org_name, ''));
  v_prop_name text := btrim(coalesce(p_property_name, ''));
  v_code_text text := coalesce(p_code, '');
begin
  if not p_email_verified then
    raise exception 'Verify your email first';
  end if;
  if coalesce(p_user_id, '') = '' or coalesce(p_email, '') = '' then
    raise exception 'Not signed in';
  end if;

  -- One attempt at a time per user, and none while locked out.
  insert into public.signup_attempts (user_id) values (p_user_id) on conflict do nothing;
  select a.locked_until into v_locked from public.signup_attempts a where a.user_id = p_user_id for update;
  if v_locked > now() then
    raise exception 'Too many wrong invite codes. Try again in 15 minutes';
  end if;

  if exists (select 1 from public.members m where m.user_id = p_user_id) then
    raise exception 'You already belong to a hotel';
  end if;
  if char_length(v_org_name) not between 1 and 80 or char_length(v_prop_name) not between 1 and 80 then
    raise exception 'Enter a hotel name and a property name of up to 80 characters';
  end if;
  -- A second wall in case codes leak: cap how fast new hotels can appear across the whole service.
  if (select count(*) from public.orgs o where o.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many new hotels right now. Try again later';
  end if;

  if char_length(v_code_text) <= 100 then
    update public.signup_codes c
       set uses_left = c.uses_left - 1
     where c.code_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
             pg_catalog.upper(pg_catalog.regexp_replace(v_code_text, '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
       and c.uses_left > 0
       and c.expires_at > now()
    returning c.id into v_code;
  end if;

  if v_code is null then
    update public.signup_attempts a
       set failed = case when a.failed + 1 >= 5 then 0 else a.failed + 1 end,
           locked_until = case when a.failed + 1 >= 5 then now() + interval '15 minutes' else a.locked_until end
     where a.user_id = p_user_id;
    return query select null::uuid, null::uuid, 'That invite code is not valid. Check it, or ask OCS for a new one'::text;
    return;
  end if;

  insert into public.orgs (name) values (v_org_name) returning id into v_org;
  insert into public.properties (org_id, name) values (v_org, v_prop_name) returning id into v_prop;
  insert into public.members (org_id, email, user_id, role, claimed_at)
    values (v_org, lower(btrim(p_email)), p_user_id, 'owner', now());
  update public.signup_codes c set used_by_org = v_org, used_at = now() where c.id = v_code;
  delete from public.signup_attempts a where a.user_id = p_user_id;
  return query select v_org, v_prop, null::text;
end
$$;

revoke all on function create_org(text, text, boolean, text, text, text) from public;
grant execute on function create_org(text, text, boolean, text, text, text) to app_user;
