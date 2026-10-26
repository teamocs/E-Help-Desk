-- Tenant model: orgs -> properties -> staff. Every domain row carries org_id and property_id.
-- Composite foreign keys make it impossible to point a row at another org's (or another
-- property's) data, even for a role that bypasses row-level security.
-- Shapes follow src/domain/types.ts. The per-row events[] / audit[] / log[] arrays become one
-- append-only `events` table.
--
-- Idempotency pattern for server actions (offline clients retry with the same op id):
--   1. insert into events (org_id, property_id, entity, entity_id, what, op_id) ... on conflict do nothing returning id
--   2. no row back => the op already ran; return the existing result and stop
--   3. otherwise bump the counter and write the change in the same transaction.
-- Checking before bumping keeps ticket numbers free of gaps.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  -- Per-property counters for T-0001, WO-0001, INC-001. Bumped inside the same transaction as the insert.
  ticket_seq int not null default 0,
  wo_seq int not null default 0,
  inc_seq int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

-- Owners and managers sign in with Neon Auth. user_id is filled by claim_membership() on first
-- sign-in, and only for a verified email. See 0002_rls.sql.
create table members (
  org_id uuid not null references orgs (id) on delete cascade,
  email text not null check (email = lower(email)),
  user_id text,
  role text not null check (role in ('owner', 'manager')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key (org_id, email),
  unique (org_id, user_id)
);

-- Staff sign in with a PIN on a device that is already signed in to the org.
-- pin_hash, pin_failed and pin_locked_until are never readable by the app role; PIN checks go
-- through the functions in 0002_rls.sql.
create table staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  name text not null,
  initials text not null,
  role text not null check (role in ('hdo', 'staff', 'supervisor', 'manager', 'owner')),
  title text not null,
  dept text check (dept in ('housekeeping', 'engineering', 'it', 'fnb', 'frontdesk', 'security')),
  on_shift boolean not null default true,
  active boolean not null default true,
  pin_hash text,
  pin_failed int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

-- token_hash is the SHA-256 of a random 256-bit token held by the device. Never readable by the app role.
create table devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  label text not null,
  token_hash text not null unique,
  signed_in_by text,
  pin_failed int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  ticket_no int not null,
  room text not null,
  source text not null check (source in ('guest', 'staff')),
  remarks text,
  logged_by uuid,
  vip boolean not null default false,
  incomplete boolean not null default false,
  safety_id uuid,
  -- Client-generated id so a retried tap never creates a second ticket.
  op_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (logged_by, org_id) references staff (id, org_id),
  unique (id, org_id, property_id),
  unique (property_id, ticket_no),
  unique (org_id, op_id)
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  wo_no int not null,
  area text not null,
  loc text not null,
  descr text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  dept text not null check (dept in ('housekeeping', 'engineering', 'it', 'fnb', 'frontdesk', 'security')),
  status text not null default 'reported' check (status in ('reported', 'assessed', 'in_progress', 'on_hold', 'done')),
  reported_by uuid,
  encoded_by uuid,
  assessment text,
  assign_type text check (assign_type in ('inhouse', 'outsource')),
  contractor text,
  est_cost numeric(12, 2) check (est_cost >= 0),
  actual_cost numeric(12, 2) check (actual_cost >= 0),
  target_end timestamptz,
  src_item_id uuid,
  op_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (reported_by, org_id) references staff (id, org_id),
  foreign key (encoded_by, org_id) references staff (id, org_id),
  unique (id, org_id, property_id),
  unique (property_id, wo_no),
  unique (org_id, op_id)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  request_id uuid not null,
  name text not null,
  qty int not null default 1 check (qty > 0),
  dept text not null check (dept in ('housekeeping', 'engineering', 'it', 'fnb', 'frontdesk', 'security')),
  assignee uuid,
  status text not null default 'new' check (status in
    ('new', 'relayed', 'on_site', 'on_hold', 'done', 'transferred', 'escalated', 'cant_do', 'duplicate', 'cancelled')),
  hold_reason text check (hold_reason in ('parts', 'no_access', 'dnd', 'vendor', 'guest_declined')),
  created_at timestamptz not null default now(),
  ack_at timestamptz,
  done_at timestamptz,
  hold_since timestamptz,
  held_ms bigint not null default 0,
  sla_min int not null check (sla_min > 0),
  depends_on uuid,
  x_from uuid,
  wo_id uuid,
  st_before_esc text check (st_before_esc in
    ('new', 'relayed', 'on_site', 'on_hold', 'done', 'transferred', 'escalated', 'cant_do', 'duplicate', 'cancelled')),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (request_id, org_id, property_id) references requests (id, org_id, property_id) on delete cascade,
  foreign key (assignee, org_id) references staff (id, org_id),
  foreign key (depends_on, org_id, property_id) references items (id, org_id, property_id),
  foreign key (x_from, org_id, property_id) references items (id, org_id, property_id),
  foreign key (wo_id, org_id, property_id) references work_orders (id, org_id, property_id),
  unique (id, org_id, property_id)
);

alter table work_orders add foreign key (src_item_id, org_id, property_id) references items (id, org_id, property_id);

create table clean_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  room text not null,
  type text not null check (type in ('Regular', 'Checkout', 'Deep clean', 'Touch-up', 'Pre-arrival', 'VIP setup', 'Turndown')),
  status text not null default 'scheduled' check (status in ('scheduled', 'queued', 'ready', 'in_progress', 'done')),
  assignee uuid,
  created_at timestamptz not null default now(),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (assignee, org_id) references staff (id, org_id),
  unique (id, org_id)
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  inc_no int not null,
  hazard text not null check (hazard in ('smoke', 'gas', 'flood', 'medical', 'threat', 'lift')),
  rooms text[] not null,
  text text not null,
  status text not null default 'active' check (status in ('active', 'downgraded', 'resolved')),
  called911_by uuid,
  called911_at timestamptz,
  op_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (called911_by, org_id) references staff (id, org_id),
  unique (id, org_id),
  unique (property_id, inc_no),
  unique (org_id, op_id)
);

-- Append-only history. `at` is server receipt time; device_at is when the person tapped.
-- One op may write several events for one entity (for example ack then done), so the unique
-- key includes `what`.
create table events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  property_id uuid not null,
  entity text not null check (entity in ('request', 'item', 'work_order', 'clean_task', 'incident')),
  entity_id uuid not null,
  what text not null,
  by_staff uuid,
  op_id uuid not null,
  device_at timestamptz,
  at timestamptz not null default now(),
  foreign key (property_id, org_id) references properties (id, org_id) on delete cascade,
  foreign key (by_staff, org_id) references staff (id, org_id),
  unique (org_id, op_id, entity_id, what)
);

create index requests_property_created on requests (property_id, created_at desc);
create index items_request on items (request_id);
create index items_open on items (property_id, status, created_at) where status in ('new', 'relayed', 'on_site', 'on_hold');
create index items_assignee on items (assignee) where assignee is not null;
create index items_wo on items (wo_id) where wo_id is not null;
create index events_entity on events (entity, entity_id, at);
create index events_feed on events (property_id, at desc);
create index work_orders_property_status on work_orders (property_id, status, created_at desc);
create index clean_tasks_property_status on clean_tasks (property_id, status);
