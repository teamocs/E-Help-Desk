-- Azalea Hotels, the pilot tenant. Safe to run twice. Staff PINs are set in the app, not here.
-- The pilot property is still undecided, so both properties exist.

insert into orgs (id, name) values
  ('a0a0a0a0-0000-4000-8000-000000000001', 'Azalea Hotels')
on conflict do nothing;

insert into properties (id, org_id, name) values
  ('a0a0a0a0-0000-4000-8000-000000000011', 'a0a0a0a0-0000-4000-8000-000000000001', 'Azalea Boracay'),
  ('a0a0a0a0-0000-4000-8000-000000000012', 'a0a0a0a0-0000-4000-8000-000000000001', 'Azalea Baguio')
on conflict do nothing;

-- The owner signs in with Neon Auth; user_id is filled on first sign-in.
insert into members (org_id, email, role) values
  ('a0a0a0a0-0000-4000-8000-000000000001', 'teamocsph@gmail.com', 'owner')
on conflict do nothing;

-- Demo staff, same people as the prototype.
insert into staff (id, org_id, name, initials, role, title, dept, on_shift) values
  ('a0a0a0a0-0000-4000-8000-000000000101', 'a0a0a0a0-0000-4000-8000-000000000001', 'Maria Santos',   'MS', 'hdo',        'Head Desk Officer',       'frontdesk',    true),
  ('a0a0a0a0-0000-4000-8000-000000000102', 'a0a0a0a0-0000-4000-8000-000000000001', 'Joel Dizon',     'JD', 'staff',      'Room Attendant',          'housekeeping', true),
  ('a0a0a0a0-0000-4000-8000-000000000103', 'a0a0a0a0-0000-4000-8000-000000000001', 'Ramon Cruz',     'RC', 'staff',      'Engineer',                'engineering',  true),
  ('a0a0a0a0-0000-4000-8000-000000000104', 'a0a0a0a0-0000-4000-8000-000000000001', 'Paolo Rivera',   'PR', 'staff',      'IT Support',              'it',           true),
  ('a0a0a0a0-0000-4000-8000-000000000105', 'a0a0a0a0-0000-4000-8000-000000000001', 'Liza Abad',      'LA', 'supervisor', 'Housekeeping Supervisor', 'housekeeping', true),
  ('a0a0a0a0-0000-4000-8000-000000000106', 'a0a0a0a0-0000-4000-8000-000000000001', 'Ana Villanueva', 'AV', 'manager',    'Duty Manager',            null,           true),
  ('a0a0a0a0-0000-4000-8000-000000000107', 'a0a0a0a0-0000-4000-8000-000000000001', 'Mr. Reyes',      'MR', 'owner',      'Owner',                   null,           true),
  ('a0a0a0a0-0000-4000-8000-000000000108', 'a0a0a0a0-0000-4000-8000-000000000001', 'Dennis Lim',     'DL', 'staff',      'Night Engineer',          'engineering',  false)
on conflict do nothing;
