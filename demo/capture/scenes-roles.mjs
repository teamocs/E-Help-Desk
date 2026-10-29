// Chapters J (shared phone), N (who sees what), Q (a day as each user type) and P (empty desk).
import { add, side, newRequest, ROOM, PIN, deskUrl } from './chapters.mjs';
import { sheet, NEEDS } from './scenes-desk.mjs';

const title = (t) => ({ css: '.group-title', has: t });
const person = (name) => ({ btn: name, within: '.people' });
const insp = (name, extra = {}) => ({ btn: name, within: '.insp', ...extra });
const row = (room) => ({ css: '.ticket', has: room });
const page = (env, vp, o) => env.newPage(env.browser, { vp, url: deskUrl(env, o), role: o.role ?? 'owner', hotel: o.hotel ?? 'baguio' });
const nav = (env, vp, name) => (vp === 'phone' ? env.C(`Open ${name}`, { btn: name, within: '.tabbar' }) : side(env, name));

/* ---------- J. SHARED PHONE ---------- */
add('J', async (env) => {
  const { shot, chapter, C, L, digits } = env;
  const c = await page(env, 'desktop', { role: 'device' });
  chapter('J', 'The shared phone', 'device', 'One phone is shared by the team. Each person picks their name and enters a four-digit PIN before doing anything.');
  await shot(c, { slug: 'shared-phone-who', scroll: { spec: { btn: '0', within: PIN }, block: 'end' }, title: 'Who is using this phone?', say: 'On a shared phone, each person taps their own name and then types their PIN.', targets: [L('Names of the people on shift', { css: '.people' }), C('Pick a name', person('Joel Dizon')), C('Tap 0 four times', { btn: '0', within: PIN, repeat: 4 })] });
  await shot(c, { slug: 'shared-phone-wrong-pin', title: 'Wrong PIN message', say: 'A wrong PIN shows a clear message and the dots start again. Nothing is opened.', targets: [L('Message about the wrong PIN', { css: '[role="alert"]' }), ...digits('1234', PIN)] });
  await shot(c, { slug: 'shared-phone-signed-in', title: 'Signed in with a PIN', say: 'Joel is signed in. His name is shown at the bottom and he sees his own department first. There are only four tabs.', targets: [L('Who is signed in', { css: '.side .usermenu-btn' }), L('Only my department', { btn: 'My department' }), C('Open the person menu', { css: '.side .usermenu-btn' })] });
  await shot(c, { slug: 'shared-phone-user-menu', title: 'Switch person', say: 'When the shift changes hands, tap Switch person so the next person signs in with their own PIN.', targets: [C('Switch person', { btn: 'Switch person', within: '.usermenu-panel' })] });
  await shot(c, { slug: 'shared-phone-switched', title: 'Back to the names', say: 'The phone returns to the list of names. Nobody inherits the previous person’s sign-in.', targets: [L('Names of the people on shift', { css: '.people' })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'device' });
  await shot(p, { slug: 'phone-shared-phone-who', scroll: { spec: { btn: '0', within: PIN }, block: 'end' }, title: 'Who is using this phone?', say: 'The same name and PIN screen on a phone.', targets: [L('Names', { css: '.people' }), C('Pick a name', person('Joel Dizon')), C('Tap 0 four times', { btn: '0', within: PIN, repeat: 4 })] });
  await shot(p, { slug: 'phone-shared-phone-wrong-pin', title: 'Wrong PIN message', say: 'A wrong PIN shows a message and nothing opens.', targets: [L('Message about the wrong PIN', { css: '[role="alert"]' }), ...digits('1234', PIN)] });
  await shot(p, { slug: 'phone-shared-phone-signed-in', title: 'Signed in on a shared phone', say: 'The shared phone shows four tabs only. There is no Settings on a shared phone.', targets: [L('Four tabs only', { css: '.tabbar' }), C('More', { btn: 'More', within: '.tabbar' })] });
  await shot(p, { slug: 'phone-shared-phone-more', title: 'Fewer options on a shared phone', say: 'Under More there is no Insights and no Settings, only Switch person, the paper forms and Sign out.', targets: [C('Switch person', sheet('Switch person'))] });
  await p.page.close();
});

/* ---------- N. WHO SEES WHAT ---------- */
add('N', async (env) => {
  const { shot, chapter, C, L, steps, digits } = env;
  chapter('N', 'Who sees what', 'everyone', 'The owner, a manager, a supervisor and a shared phone each see a different set of tabs and settings.');
  const sidebar = { owner: ['Hotel owner', 'All six tabs, including Insights and Settings.'], manager: ['Manager', 'All six tabs. In Settings a manager can change staff and lists but not logins.'], supervisor: ['Supervisor', 'All six tabs. In Settings a supervisor only sees the display options.'] };
  for (const role of ['owner', 'manager', 'supervisor']) {
    const c = await page(env, 'desktop', { role });
    await shot(c, { slug: `sidebar-${role}`, title: `Tabs for the ${sidebar[role][0].toLowerCase()}`, say: `As the ${sidebar[role][0].toLowerCase()}: ${sidebar[role][1]}`, targets: [L('All the tabs', { css: '.side nav, nav.side' }), L('Who is signed in', { css: '.side .usermenu' })] });
    if (role !== 'owner') {
      await shot(c, {
        slug: `settings-${role}`, title: `Settings for the ${sidebar[role][0].toLowerCase()}`, say: `As the ${sidebar[role][0].toLowerCase()}: ${role === 'manager' ? 'Staff and Lists are here, but there is no Logins section.' : 'there is no Staff, Lists or Logins section, only the display options.'}`,
        prep: (p) => steps(p, [side(env, 'Settings')]), scroll: { spec: title('Display'), block: 'start' }, targets: [L('Display options', { ...title('Display'), words: true })],
      });
    }
    await c.page.close();
  }
  const d = await page(env, 'desktop', { role: 'device' });
  await shot(d, { slug: 'sidebar-shared-phone', title: 'Tabs on a shared phone', say: 'On a shared phone after a PIN sign-in there are only four tabs and no Settings or Insights.', prep: (p) => steps(p, [C('Pick a name', person('Joel Dizon')), ...digits('1234', PIN)]), targets: [L('Only four tabs', { css: '.side nav, nav.side' }), L('Who is signed in', { css: '.side .usermenu' })] });
  await d.page.close();
});

/* ---------- Q. A DAY AS EACH USER ---------- */
add('Q', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const label = (nth) => ({ css: '.le-item input[id$="-label"]', nth });

  // 1. The hotel owner
  let c = await page(env, 'desktop', { role: 'owner', q: '&ack=0' });
  chapter('Q1', 'A day as the hotel owner', 'owner', 'The owner sees every tab, changes the hotel’s settings and lists, adds logins, checks the numbers and signs the handover.');
  await shot(c, { slug: 'owner-home', title: 'Owner: the home screen', say: 'As the hotel owner you see every tab: requests, repair jobs, housekeeping, handover, insights and settings.', targets: [L('Every tab', { css: '.side nav, nav.side' }), side(env, 'Settings')] });
  await shot(c, { slug: 'owner-settings-lists', title: 'Owner: Settings and Lists', say: 'As the hotel owner, open Settings to find the staff list, your own lists and the logins. Tap Departments to change one.', scroll: { spec: title('Lists'), block: 'start' }, targets: [L('Your own lists', { ...title('Lists'), words: true }), C('Departments', { btn: 'Departments' })] });
  await shot(c, { slug: 'owner-edit-department', title: 'Owner: rename a department', say: 'As the hotel owner, change the name of a department, for example IT to IT Support, and save.', scroll: { spec: label(2), block: 'center' }, targets: [T('Department name', label(2), 'IT Support'), C('Save changes', { css: '.sheet .le-foot .btn-fill' })] });
  await shot(c, { slug: 'owner-department-saved', title: 'Owner: department saved', say: 'As the hotel owner, you see a message that the list was saved. Every phone gets the new name.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Close', sheet('Close'))] });
  await shot(c, { slug: 'owner-add-login', title: 'Owner: add a manager login', say: 'As the hotel owner, give a manager a login: type the name and email and choose Manager. They get an email to choose a password.', scroll: { spec: { css: '#lg-email' }, block: 'center' }, targets: [T('Name', { css: '#lg-name' }, 'Dennis Lim'), T('Email', { css: '#lg-email' }, 'dennis.lim@example.test'), C('Role', { css: '#lg-role', value: 'manager' }), C('Add login', { btn: 'Add login', within: 'form' })] });
  await shot(c, { slug: 'owner-login-added', title: 'Owner: the login is added', say: 'As the hotel owner, you see the new manager in the list. You can switch the login off at any time.', keepToast: true, scroll: { spec: title('Logins'), block: 'start' }, targets: [L('The new manager login', { css: '.row', has: 'Dennis Lim' }), side(env, 'Insights')] });
  await shot(c, { slug: 'owner-insights', title: 'Owner: check the numbers', say: 'As the hotel owner, open Insights to see the live counts for the desk and how each department is doing.', targets: [L('The numbers', { css: '.tiles' }), side(env, 'Handover')] });
  await shot(c, { slug: 'owner-handover', title: 'Owner: sign the handover', say: 'As the hotel owner, read the shift summary and tap Acknowledge handover.', scroll: { spec: { btn: 'Acknowledge handover' }, block: 'end' }, targets: [C('Acknowledge handover', { btn: 'Acknowledge handover' })] });
  await shot(c, { slug: 'owner-handover-signed', title: 'Owner: handover signed', say: 'As the hotel owner, you see that the handover is signed with the name and the time.', scroll: { spec: { css: '.banner.ok' }, block: 'center' }, targets: [L('Who signed and when', { css: '.banner.ok' })] });
  await c.page.close();

  // 2. The manager
  c = await page(env, 'desktop', { role: 'manager' });
  chapter('Q2', 'A day as the manager', 'manager', 'The manager runs the desk, handles a safety alert and looks after the staff list and the hold reasons, but has no Logins section.');
  await shot(c, { slug: 'manager-home', title: 'Manager: the home screen', say: 'As a manager you run the desk. You see every tab and the same request list as everyone else.', targets: [L('Every tab', { css: '.side nav, nav.side' }), L('Signed in as manager', { css: '.side .usermenu' }), newRequest(env)] });
  await shot(c, { slug: 'manager-safety-warning', title: 'Manager: a safety warning', say: 'As a manager, when a receptionist types a worrying word, you see the same red warning before it is sent.', prep: (p) => steps(p, [...digits('220', ROOM), T('Remark box', sheet('Remark'), 'may usok sa hallway')]), scroll: { spec: { css: '.sheet .banner.bad' }, block: 'center' }, targets: [L('Safety warning', { css: '.sheet .banner.bad' }), C('Raise safety alert', sheet('Raise safety alert'))] });
  await shot(c, { slug: 'manager-safety-alert', title: 'Manager: handle the alert', say: 'As a manager, you can record that 911 was called and later sign the alert off as resolved.', targets: [L('What to do first', { css: '#sf-title', words: true }), C('I called 911 just now', { btn: 'I called 911 just now' }), C('Resolve with sign-off', { btn: 'Resolve with sign-off' })] });
  await shot(c, { slug: 'manager-settings', title: 'Manager: Settings has no Logins', say: 'As a manager, Settings shows the staff list and your lists. There is no Logins section, because only the owner manages logins.', prep: async (p) => { await env.sleep(500); await steps(p, [side(env, 'Settings')]); }, scroll: { spec: title('Display'), block: 'start' }, targets: [L('Display follows Lists', { ...title('Display'), words: true })] });
  await shot(c, { slug: 'manager-add-staff', title: 'Manager: add a staff person', say: 'As a manager, add a person to the staff list with a job title, a department and a four-digit PIN.', scroll: { spec: { css: '#st-role' }, block: 'center' }, targets: [T('Full name', { css: '#st-name' }, 'Dennis Lim'), T('Job title', { css: '#st-title' }, 'Night Engineer'), C('Department', { css: '#st-dept', value: 'engineering' }), T('Four-digit PIN', { css: '#st-pin' }, '4821'), C('Add person', { btn: 'Add person' })] });
  await shot(c, { slug: 'manager-staff-added', title: 'Manager: the person is added', say: 'As a manager, you see a message that the person was added. They can now sign in on a shared phone with their PIN.', keepToast: true, scroll: { spec: title('Staff'), block: 'start' }, targets: [L('The new person', { css: '.row', has: 'Dennis Lim' })] });
  await shot(c, { slug: 'manager-edit-hold-reason', title: 'Manager: edit a hold reason', prep: (p) => steps(p, [C('Hold reasons', { btn: 'Hold reasons' })]), say: 'As a manager, change the wording of a hold reason so it matches how your team speaks, then save.', scroll: { spec: label(0), block: 'center' }, targets: [T('Hold reason name', label(0), 'Waiting for spare parts'), C('Save changes', { css: '.sheet .le-foot .btn-fill' })] });
  await shot(c, { slug: 'manager-hold-reason-saved', title: 'Manager: hold reason saved', say: 'As a manager, you see that the change was saved for every phone.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Close', sheet('Close'))] });
  await c.page.close();

  // 3. The supervisor
  c = await page(env, 'desktop', { role: 'supervisor' });
  chapter('Q3', 'A day as the supervisor', 'supervisor', 'The supervisor works the desk: requests, repair jobs, housekeeping, handover and insights. Staff and logins are not shown.');
  await shot(c, { slug: 'supervisor-requests', title: 'Supervisor: requests', say: 'As a supervisor, you start on the request list and see what is open, late or on hold.', targets: [L('Open requests', { css: '.ticket', nth: 0 }), side(env, 'Work orders')] });
  await shot(c, { slug: 'supervisor-work-orders', title: 'Supervisor: repair jobs', say: 'As a supervisor, you follow repair jobs from reported to done.', targets: [L('Repair jobs by stage', { css: '.group-title', nth: 0, words: true }), side(env, 'Housekeeping')] });
  await shot(c, { slug: 'supervisor-housekeeping', title: 'Supervisor: housekeeping', say: 'As a supervisor, you see which rooms are ready to clean and who is cleaning them.', targets: [L('Rooms to clean', { css: '.group-title', nth: 0, words: true }), side(env, 'Handover')] });
  await shot(c, { slug: 'supervisor-handover', title: 'Supervisor: handover', say: 'As a supervisor, you check the shift summary before the next shift starts.', targets: [L('Shift numbers', { css: '.tiles' }), side(env, 'Insights')] });
  await shot(c, { slug: 'supervisor-insights', title: 'Supervisor: insights', say: 'As a supervisor, you check the numbers for your department.', targets: [L('The numbers', { css: '.tiles' }), side(env, 'Settings')] });
  await shot(c, { slug: 'supervisor-settings', title: 'Supervisor: limited Settings', say: 'As a supervisor, Settings only has the display options. The staff list, lists and logins are not shown.', targets: [L('Only display options', { ...title('Display'), words: true })] });
  await c.page.close();

  // 4. The shared phone
  c = await page(env, 'desktop', { role: 'device' });
  chapter('Q4', 'A day on the shared phone', 'device', 'A shared phone at the front desk or in housekeeping: pick a name, type a PIN, log a request, finish a job and switch person.');
  await shot(c, { slug: 'shared-day-who', title: 'Shared phone: who is using it?', say: 'On the shared phone, pick your name and type your PIN.', targets: [L('Names', { css: '.people' }), C('Pick a name', person('Joel Dizon')), ...digits('1234', PIN)] });
  await shot(c, { slug: 'shared-day-home', title: 'Shared phone: four tabs only', say: 'On the shared phone you see four tabs and no Settings. Tap New request to log a guest request.', targets: [L('Four tabs only', { css: '.side nav, nav.side' }), newRequest(env)] });
  await shot(c, { slug: 'shared-day-room', title: 'Shared phone: tap the room', say: 'On the shared phone, tap the room number on the keypad.', targets: digits('418', ROOM) });
  await shot(c, { slug: 'shared-day-needs', title: 'Shared phone: choose and send', say: 'On the shared phone, choose what the guest needs and tap Log request.', scroll: NEEDS, targets: [C('Extra pillow', sheet('Extra pillow'))] });
  await shot(c, { slug: 'shared-day-ready', title: 'Shared phone: send it', say: 'On the shared phone, tap Log request. The request is recorded under your name.', scroll: { spec: sheet('Log request'), block: 'end' }, targets: [C('Log request', sheet('Log request'))] });
  await shot(c, { slug: 'shared-day-logged', title: 'Shared phone: request logged', say: 'On the shared phone, the new request appears in your department’s list. Tap it to open it.', keepToast: true, targets: [L('The new request', row('418')), C('Open the request', row('418'))] });
  await shot(c, { slug: 'shared-day-on-site', title: 'Shared phone: mark on site', say: 'On the shared phone, tap On site when you reach the room.', targets: [C('On site', insp('On site'))] });
  await shot(c, { slug: 'shared-day-finish', title: 'Shared phone: finish the job', say: 'On the shared phone, tap Done when the pillow is delivered.', targets: [C('Done', insp('Done'))] });
  await shot(c, { slug: 'shared-day-done', title: 'Shared phone: job finished', say: 'On the shared phone, the job shows as Done with your name in its history. Open the person menu to hand the phone over.', targets: [L('History with your name', { css: '.insp .timeline' }), C('Open the person menu', { css: '.side .usermenu-btn' })] });
  await shot(c, { slug: 'shared-day-switch', title: 'Shared phone: switch person', say: 'On the shared phone, tap Switch person so the next person can sign in with their own PIN.', targets: [C('Switch person', { btn: 'Switch person', within: '.usermenu-panel' })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'device' });
  await shot(p, { slug: 'phone-shared-day-home', title: 'Shared phone: the phone view', say: 'On the shared phone, the phone screen has four tabs and a big New request button.', prep: (pg) => steps(pg, [C('Pick a name', person('Joel Dizon')), ...digits('1234', PIN)]), targets: [L('Four tabs only', { css: '.tabbar' }), L('New request', { css: '.fab' })] });
  await p.page.close();
});

/* ---------- P. EMPTY STATES (last: ?empty=1 clears the sample desk) ---------- */
add('P', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await page(env, 'desktop', { role: 'owner', q: '&empty=1' });
  chapter('P', 'A quiet day', 'owner', 'When there is nothing to show, each screen says what to do next.');
  await shot(c, { slug: 'empty-requests', title: 'No open requests', say: 'When no request is open, the list says so and offers a New request button.', targets: [L('Nothing open', { css: '.empty' }), side(env, 'Work orders')] });
  await shot(c, { slug: 'empty-work-orders', title: 'No repair jobs yet', say: 'With no repair jobs, the screen explains that they start from a request.', targets: [L('Nothing yet', { css: '.empty' }), side(env, 'Housekeeping')] });
  await shot(c, { slug: 'empty-housekeeping', title: 'No rooms to clean', say: 'With no rooms to clean, the screen offers to log a cleaning request.', targets: [L('Nothing to clean', { css: '.empty' })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'owner', q: '&empty=1' });
  await shot(p, { slug: 'phone-empty-requests', title: 'A quiet day on a phone', say: 'On a phone, an empty list invites you to log the first request.', targets: [L('Nothing open', { css: '.empty' }), L('New request button', { css: '.fab' })] });
  await p.page.close();
});
