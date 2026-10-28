-- Every row an operator can change now records when it last changed. The database sets it, so no
-- code path can forget it and the app role cannot write it (column-level grants leave it out).
-- Existing rows start at their created_at. Runs after 0002, independent of the staff changes in 0008.

create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['requests', 'items', 'work_orders', 'clean_tasks', 'incidents'] loop
    execute format('alter table public.%I add column updated_at timestamptz', t);
    execute format('update public.%I set updated_at = created_at', t);
    execute format('alter table public.%I alter column updated_at set default now()', t);
    execute format('alter table public.%I alter column updated_at set not null', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;
