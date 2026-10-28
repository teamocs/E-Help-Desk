-- Shift handover sign-off. One row per sign-off; the newest one for a property is the current one.
-- Rows are append-only for the app: app_user may read and add sign-offs, never change or remove them.
-- signed_by is the staff member signed in with a PIN, or null when an owner or manager account signs
-- directly. Returning orphaned items needs no new table: it clears items.assignee, which app_user may
-- already update (0002_rls.sql), and logs an 'item' event per item.

-- Sign-offs are logged in the append-only events table like every other command.
alter table events drop constraint events_entity_check;
alter table events add constraint events_entity_check
  check (entity in ('request', 'item', 'work_order', 'clean_task', 'incident', 'handover'));

create table handovers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  signed_by uuid,
  signed_at timestamptz not null default now(),
  note text check (char_length(note) <= 1000),
  -- Client-generated id so a retried tap never records a second sign-off.
  op_id uuid not null,
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (signed_by, org_id) references staff (id, org_id),
  unique (org_id, op_id)
);

create index handovers_property_signed on handovers (property_id, signed_at desc);

alter table handovers enable row level security;
create policy tenant on handovers for all to app_user using (org_id = app_org()) with check (org_id = app_org());

grant select, insert on handovers to app_user; -- no update, no delete
