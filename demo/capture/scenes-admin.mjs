// Chapters R (Reports) and S (Configuration) on the owner desk.
import { add, main, side, scr, goTo } from './chapters.mjs';
import { sheet } from './scenes-desk.mjs';

const form = (name) => ({ field: name, within: '.sheet' });
const tile = (name) => ({ css: '.rp-tile', has: name });

/* ---------- R. REPORTS ---------- */
add('R', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await main(env);
  chapter('R', 'Reports', 'owner', 'Six reports about the hotel’s service, with a date range and a CSV file to download. They describe the work, never a ranking of people.');
  // Each report is opened from the list; the way back is the All reports button.
  const open = (name) => async (p) => {
    try { await env.steps(p, [C('All reports', scr('All reports'))]); } catch { /* already on the list */ }
    await env.steps(p, [C(`Open ${name}`, tile(name))]);
  };
  await shot(c, {
    slug: 'reports-home', title: 'The Reports page', say: 'The top shows today at a glance. Below it are six reports. Supervisors can read them, and only the owner and managers change settings elsewhere.', prep: goTo(env, 'Reports'),
    targets: [L('Today at a glance', { css: '.rp-h2', has: 'Today at a glance', words: true }), L('Counts for the shift', { text: 'Tickets logged this shift', words: true }), L('By department', { text: 'By department, the items', words: true })],
  });
  await shot(c, {
    slug: 'reports-list', title: 'The six reports', say: 'Tap a report to open it. Each one has its own filters and a Download CSV button that opens in Excel.', scroll: { spec: tile('Response Time'), block: 'center' },
    targets: [L('The six reports', tile('KPI Dashboard')), C('Response Time report', tile('Response Time'))],
  });
  await shot(c, {
    slug: 'report-response-time', title: 'Response time report', say: 'How fast requests were relayed and completed, by request type and department. The range can be today, seven days, thirty days or this month.',
    targets: [L('Date range', { css: '.chip', has: '7 days' }), L('Department and type filters', { field: 'Department', within: '.screen' }), L('Download as a CSV file', scr('Download CSV')), L('Totals for the period', { text: 'Items logged', words: true }), C('30 days', scr('30 days'))],
  });
  await shot(c, {
    slug: 'report-response-time-30', title: 'A longer range', say: 'Pick another range and the table follows. Tap a column heading to sort by it.', targets: [L('Totals for the period', { text: 'Items logged', words: true }), L('Time to relay', { text: 'Time to relay', words: true }), C('Back to all reports', scr('All reports'))],
  });
  await shot(c, { slug: 'report-kpi', title: 'KPI dashboard', say: 'The key figures for the period next to the period before, with the change. Show the numbers gives the same figures as plain text.', prep: open('KPI Dashboard'), targets: [L('Compared with the period before', { text: 'Compared with the 30 days before', words: true }), L('Tickets logged', { text: 'Tickets logged', words: true }), C('Back to all reports', scr('All reports'))] });
  await shot(c, { slug: 'report-turnaround', title: 'Room turnaround report', say: 'How long it takes from checkout to a clean room, by room type or by room attendant’s team.', prep: open('Room Turnaround'), targets: [L('Date range', { css: '.chip', has: '7 days' }), L('Rooms cleaned', { text: 'Rooms cleaned', words: true }), L('Checkout to clean room', { text: 'Checkout to clean room', words: true }), C('Back to all reports', scr('All reports'))] });
  await shot(c, { slug: 'report-work-orders', title: 'Work order summary', say: 'Work orders by status, priority and department, with the estimated and the real cost side by side.', prep: open('WO Summary'), targets: [L('Date range', { css: '.chip', has: '7 days' }), L('Work orders reported', { text: 'Work orders reported', words: true }), L('By status', { text: 'By status', words: true }), C('Back to all reports', scr('All reports'))] });
  await shot(c, { slug: 'report-inquiries', title: 'Inquiry volume report', say: 'How many inquiries came in each day and hour, and from whom: in-house guests, external callers and checked-out guests.', prep: open('Inquiry Volume'), targets: [L('Date range', { css: '.chip', has: '7 days' }), L('Inquiries per day', { text: 'Inquiries per day', words: true }), L('Inquiries by hour', { text: 'Inquiries by hour of the day', words: true }), C('Back to all reports', scr('All reports'))] });
  await shot(c, { slug: 'report-crisis', title: 'Crisis log report', say: 'Crisis cases by code and place, and how long each took to close. Use it to see where trouble repeats.', prep: open('Crisis Log'), targets: [L('Date range', { css: '.chip', has: '7 days' }), L('Cases by code', { text: 'By code', words: true }), L('Download as a CSV file', scr('Download CSV')), side(env, 'Configuration')] });
});

/* ---------- S. CONFIGURATION ---------- */
const SECTIONS = [
  // [link, heading id, slug, title, say]
  ['Departments & Staff', 'cfg-departments-h', 'departments', 'Departments', 'Each department has a name, a short badge and a mark if it handles repairs. Departments that handle repairs get the work orders.'],
  ['Service Items', 'cfg-requestTypes-h', 'service-items', 'Service items', 'The service items are the choices in the New request form, grouped by department, each with its own target time.'],
  ['Crisis Codes', 'cfg-crisisCodes-h', 'crisis-codes', 'Crisis codes', 'The radio codes offered when a crisis case is logged, for example 10-9 for a medical emergency.'],
  ['Vehicles', 'cfg-vehicles-h', 'vehicles', 'Vehicles', 'The cars and vans that trips are logged for. They appear in the Log Trip form.'],
  ['Areas', 'cfg-woAreas-h', 'areas', 'Areas', 'Where a work order is: a room, a public area, the staff house and so on.'],
  ['Cleaning Types', 'cfg-cleaningTypes-h', 'cleaning-types', 'Cleaning types', 'The kinds of clean a room attendant can log, such as Regular or Checkout.'],
  ['Complaint Categories', 'cfg-complaintCategories-h', 'complaint-categories', 'Complaint categories', 'What a guest complaint is about, used when a complaint is logged as a crisis case.'],
  ['Crisis Locations', 'cfg-crisisLocations-h', 'crisis-locations', 'Crisis locations', 'The places in the hotel that can be chosen for a crisis case, such as the lobby or the pool.'],
  ['Involved Types', 'cfg-involvedTypes-h', 'involved-types', 'Who was involved', 'The kinds of people who can be involved in a crisis case, such as an in-house guest or a visitor.'],
  ['Job Titles', 'cfg-jobTitles-h', 'job-titles', 'Job titles', 'Job titles are suggested when a person is added to the staff list.'],
  ['Hold Reasons', 'cfg-holdReasons-h', 'hold-reasons', 'Hold reasons', 'The reasons offered when a request has to wait. Putting a request on hold stops its timer.'],
  ['Bundles', 'cfg-bundles-h', 'bundles', 'Bundles', 'A bundle creates several jobs at once, for example a leak that needs Engineering first and then Housekeeping.'],
  ['Work-Order Findings', 'cfg-woFindings-h', 'work-order-findings', 'Work order findings', 'Quick answers offered when someone assesses a work order.'],
  ['Help-Desk Staff', 'cfg-hdo-h', 'help-desk-staff', 'Help-desk staff', 'The people at the help desk who log requests. Each has a four-digit PIN for a shared phone.'],
  ['Staff (PINs)', 'cfg-staff-h', 'staff-pins', 'Staff and their PINs', 'Everyone who signs in on a shared phone with a four-digit PIN. A manager can set a new PIN or remove a person.'],
  ['Logins', 'cfg-logins-h', 'logins', 'Logins', 'Only the hotel owner decides who can sign in with an email and password, and can switch a login off.'],
  ['Display', 'cfg-display-h', 'display', 'Display options', 'Make the text bigger, increase the contrast or reduce movement. The choice is only for this device.'],
  ['Feel', 'cfg-feel-h', 'feel', 'Vibration and sounds', 'Choose whether the phone vibrates, whether alerts make a sound and whether keyboard shortcuts work.'],
];


add('S', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('S', 'Configuration', 'owner', 'Where the hotel sets itself up: its name, departments, the choices in every form, the staff and their PINs, the logins and how the screen looks.');
  const link = (name) => ({ btn: name, within: '.screen' });
  const goNext = (i) => (SECTIONS[i + 1] ? [C(`Open ${SECTIONS[i + 1][3]}`, link(SECTIONS[i + 1][0]))] : []);
  await shot(c, {
    slug: 'config-profile', title: 'Hotel profile', say: 'Configuration has a list of sections on the left. The hotel profile holds its name, contact details and address. The time zone is fixed to Philippine time.', prep: goTo(env, 'Configuration'),
    targets: [L('Hotel name', { css: '#pf-name' }), L('Contact', { css: '#pf-contact' }), C('Departments section', link('Departments & Staff'))],
  });
  for (let i = 0; i < SECTIONS.length; i++) {
    const [, hid, slug, title, say] = SECTIONS[i];
    const head = L(title, { css: `#${hid}`, words: true });
    if (slug === 'vehicles') {
      await shot(c, { slug: 'config-vehicles', title, say, targets: [head, C('Edit Vehicles', link('Edit Vehicles'))] });
      await shot(c, {
        slug: 'config-vehicles-edit', title: 'Edit the vehicles', say: 'Edit opens the list. Add a vehicle, rename one, move it up or down, or archive it so it stays on old trips but is not offered again.',
        targets: [L('Existing vehicles', { css: '.sheet .le-item', nth: 0 }), C('Add vehicle', sheet('Add vehicle'))],
      });
      await shot(c, {
        slug: 'config-vehicles-new', title: 'Name the new vehicle', say: 'Type the name of the new vehicle, for example Van 3, then save.',
        scroll: { spec: { css: '.le-item input[id$="-label"]', nth: -1, within: '.sheet' }, block: 'center' }, targets: [T('Vehicle name', { css: '.le-item input[id$="-label"]', nth: -1 }, 'Van 3'), C('Save changes', sheet('Save changes'))],
      });
      await shot(c, { slug: 'config-vehicles-saved', title: 'Vehicle saved', say: 'A message confirms the list was saved. Van 3 is now in the Log Trip form on every device.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Close', sheet('Close'))] });
      await env.steps(c.page, goNext(i));
    } else if (slug === 'staff-pins') {
      await shot(c, { slug: 'config-staff-pins', title, say, targets: [head, L('Remove a person', { btn: 'Remove Joel Dizon' }), C('Set a new PIN', { btn: 'Set a new PIN for Joel Dizon' })] });
      await shot(c, { slug: 'config-set-pin', title: 'Set a new PIN', say: 'Type four digits and tap Save. The PIN is never shown again, so write down a new one if it is forgotten.', targets: [T('New PIN', { btn: 'New PIN for Joel Dizon' }, '4821'), L('Save the PIN', { btn: 'Save', within: { css: '.row', has: 'Joel Dizon' } })] });
      await shot(c, {
        slug: 'config-add-person', title: 'Add a person', say: 'To add someone, type their name, pick a job title, a role and a department, and give them a four-digit PIN.',
        scroll: { spec: { css: '#st-role' }, block: 'center' }, targets: [T('Full name', { css: '#st-name' }, 'Dennis Lim'), T('Job title', { css: '#st-title' }, 'Night Engineer'), C('Department', { css: '#st-dept', value: 'engineering' }), T('Four-digit PIN', { css: '#st-pin' }, '4821'), L('Add person button', { btn: 'Add person' })],
      });
      await env.steps(c.page, goNext(i));
    } else if (slug === 'logins') {
      await shot(c, { slug: 'config-logins', title, say, targets: [head, C('Switch off a login', { btn: 'Switch off Ana Villanueva' })] });
      await shot(c, { slug: 'config-logins-off', title: 'A login switched off', say: 'A switched-off person is signed out everywhere and cannot sign in until the owner switches them on again.', targets: [L('Switched off label', { css: '.pill.warn', has: 'Switched off' }), C('Switch it on again', { btn: 'Switch on Ana Villanueva' })] });
      await shot(c, {
        slug: 'config-logins-add', title: 'Add a login', say: 'To give someone a login, type their name and email and choose their role. They get an email to set their own password.',
        scroll: { spec: { css: '#lg-email' }, block: 'center' }, targets: [T('Name', { css: '#lg-name' }, 'Ben Torres'), T('Email', { css: '#lg-email' }, 'ben.torres@example.test'), C('Role', { css: '#lg-role', value: 'supervisor' }), C('Add login', { btn: 'Add login', within: 'form' })],
      });
      await shot(c, { slug: 'config-logins-added', title: 'The new login is listed', say: 'The new person appears in the list and is emailed a link to choose a password.', keepToast: true, scroll: { spec: { css: '.row', has: 'ben.torres@example.test' }, block: 'center' }, targets: [L('The new login', { css: '.row', has: 'ben.torres@example.test' })] });
      await env.steps(c.page, goNext(i));
    } else if (slug === 'display') {
      await shot(c, { slug: 'config-display', title, say, targets: [head, L('Reduce motion', { btn: 'Reduce motion' }), L('Higher contrast', { btn: 'Increase contrast' }), C('Larger text', { css: '#ts', keys: ['ArrowRight', 'ArrowRight'] })] });
      await shot(c, { slug: 'config-display-larger', title: 'Larger text', say: 'Everything on the screen is now larger. The change is only for this device, and the slider puts it back.', scroll: { spec: { css: '#ts' }, block: 'center' }, targets: [C('Normal text size', { css: '#ts', keys: ['ArrowLeft', 'ArrowLeft'] })] });
      await env.steps(c.page, goNext(i));
    } else {
      await shot(c, { slug: `config-${slug}`, title, say, targets: [head, ...goNext(i)] });
    }
  }
});
