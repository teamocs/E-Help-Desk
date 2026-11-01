// Chapters J (shared phone), N (who sees what), O (no internet), Q (a day as each user type) and P (empty desk).
import { add, side, newRequest, scr, goTo, PIN, deskUrl } from './chapters.mjs';
import { sheet, insp, row } from './scenes-desk.mjs';

const person = (name) => ({ btn: name, within: '.people' });
const cfgLink = (name) => ({ btn: name, within: '.screen' });
const form = (name) => ({ field: name, within: '.sheet' });
const page = (env, vp, o) => env.newPage(env.browser, { vp, url: deskUrl(env, o), role: o.role ?? 'owner', hotel: o.hotel ?? 'baguio' });
const nav = (env, vp, name) => (vp === 'phone' ? env.C(`Open ${name}`, { btn: name, within: '.tabbar' }) : side(env, name));
/** Sign in on the shared phone: pick a name and tap the four digits of a PIN. */
const signIn = (env, who, pin = '1234') => [env.C('Pick a name', person(who)), ...env.digits(pin, PIN)];

/* ---------- J. SHARED PHONE ---------- */
add('J', async (env) => {
  const { shot, chapter, C, L, digits } = env;
  const c = await page(env, 'desktop', { role: 'device' });
  chapter('J', 'The shared phone', 'device', 'One phone is shared by the team. Each person picks their name and enters a four-digit PIN, and then sees only the areas their job needs.');
  await shot(c, { slug: 'shared-phone-who', scroll: { spec: { btn: '0', within: PIN }, block: 'end' }, title: 'Who is using this phone?', say: 'On a shared phone, each person taps their own name and then types their PIN.', targets: [L('Names of the people on shift', { css: '.people' }), C('Pick a name', person('Joel Dizon')), C('Tap 0 four times', { btn: '0', within: PIN, repeat: 4 })] });
  await shot(c, { slug: 'shared-phone-wrong-pin', title: 'Wrong PIN message', say: 'A wrong PIN shows a clear message and the dots start again. Nothing is opened.', targets: [L('Message about the wrong PIN', { css: '[role="alert"]' }), ...digits('1234', PIN)] });
  await shot(c, { slug: 'shared-phone-signed-in', title: 'Signed in with a PIN', say: 'Joel is signed in. His name is shown at the bottom and the sidebar lists only seven areas, the ones a room attendant needs.', targets: [L('Who is signed in', { css: '.side .usermenu-btn' }), L('Only the areas for this job', { css: '.side-list' }), C('Open the person menu', { css: '.side .usermenu-btn' })] });
  await shot(c, { slug: 'shared-phone-user-menu', title: 'Switch person', say: 'When the shift changes hands, tap Switch person so the next person signs in with their own PIN.', targets: [C('Switch person', { btn: 'Switch person', within: '.usermenu-panel' })] });
  await shot(c, { slug: 'shared-phone-switched', title: 'Back to the names', say: 'The phone returns to the list of names. Nobody inherits the previous person’s sign-in.', targets: [L('Names of the people on shift', { css: '.people' })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'device' });
  await shot(p, { slug: 'phone-shared-phone-who', scroll: { spec: { btn: '0', within: PIN }, block: 'end' }, title: 'Who is using this phone?', say: 'The same name and PIN screen on a phone.', targets: [L('Names', { css: '.people' }), C('Pick a name', person('Joel Dizon')), C('Tap 0 four times', { btn: '0', within: PIN, repeat: 4 })] });
  await shot(p, { slug: 'phone-shared-phone-wrong-pin', title: 'Wrong PIN message', say: 'A wrong PIN shows a message and nothing opens.', targets: [L('Message about the wrong PIN', { css: '[role="alert"]' }), ...digits('1234', PIN)] });
  await shot(p, { slug: 'phone-shared-phone-signed-in', title: 'Signed in on a shared phone', say: 'A room attendant sees four tabs: Requests, Cleaning, Work Orders and More. The other areas are under More.', targets: [L('The tabs', { css: '.tabbar' }), C('More', { btn: 'More', within: '.tabbar' })] });
  await shot(p, { slug: 'phone-shared-phone-more', title: 'Fewer options on a shared phone', say: 'Under More there are only the areas this person may use, and the paper forms. Switch person is in the person menu at the top of the screen.', targets: [L('Areas this person may use', sheet('House Status')), L('Paper forms', sheet('Paper kit')), C('Close', sheet('Close'))] });
  await p.page.close();
});

/* ---------- N. WHO SEES WHAT ---------- */
add('N', async (env) => {
  const { shot, chapter, C, L, steps } = env;
  chapter('N', 'Who sees what', 'everyone', 'The owner, a manager, a supervisor, a help desk officer and a room attendant each see a different set of areas, and the sections of Configuration differ too.');
  const roles = {
    owner: ['Hotel owner', 'All eleven areas, and every section of Configuration, including Logins.'],
    manager: ['Manager', 'All eleven areas. In Configuration a manager can change staff and lists but not logins.'],
    supervisor: ['Supervisor', 'All eleven areas, but Reports and Configuration can only be read.'],
  };
  for (const role of ['owner', 'manager', 'supervisor']) {
    const c = await page(env, 'desktop', { role });
    await shot(c, { slug: `sidebar-${role}`, title: `Areas for the ${roles[role][0].toLowerCase()}`, say: `As the ${roles[role][0].toLowerCase()}: ${roles[role][1]}`, targets: [L('All the areas', { css: '.side-list' }), L('Who is signed in', { css: '.side .usermenu' })] });
    if (role !== 'owner') {
      await shot(c, {
        slug: `configuration-${role}`, title: `Configuration for the ${roles[role][0].toLowerCase()}`, say: `As the ${roles[role][0].toLowerCase()}: ${role === 'manager' ? 'every section is here except Logins.' : 'the sections are for reading only. There are no Edit buttons, and Staff (PINs) and Logins are not shown.'}`,
        prep: (p) => steps(p, [side(env, 'Configuration')]), targets: [L('Sections', { css: '.cfg-nav' }), L('Hotel profile', { css: '#cfg-profile-h', words: true })],
      });
    }
    await c.page.close();
  }
  for (const [who, slug, title, say] of [
    ['Maria Santos', 'sidebar-help-desk', 'Areas for a help desk officer', 'A help desk officer on a shared phone sees ten areas. Reports is not one of them.'],
    ['Joel Dizon', 'sidebar-room-attendant', 'Areas for a room attendant', 'A room attendant sees seven areas: Requests, Cleaning, Work Orders, House Status, Crisis Mgmt, Transport and Configuration.'],
  ]) {
    const d = await page(env, 'desktop', { role: 'device' });
    await shot(d, { slug, title, say, prep: (p) => steps(p, signIn(env, who)), targets: [L('The areas', { css: '.side-list' }), L('Who is signed in', { css: '.side .usermenu' })] });
    await d.page.close();
  }
});

/* ---------- O. NO INTERNET ---------- */
add('O', async (env) => {
  const { shot, chapter, C, L, T, steps, state } = env;
  const c = await env.newPage(env.browser, { vp: 'desktop', url: deskUrl(env), role: 'owner', hotel: 'baguio' });
  const { page: pg } = c;
  chapter('O', 'No internet', 'owner', 'When the connection drops, the desk keeps working and sends everything when it is back.');
  await shot(c, {
    slug: 'offline-new-request', title: 'Logging with no internet', say: 'Even with the internet cut, a request can still be logged. The desk keeps it safe on the phone.',
    prep: async (p) => { await steps(p, [side(env, 'Requests'), newRequest(env)]); await env.sleep(500); await steps(p, [T('Room number', form('Room'), '521'), C('Item box', form('Item')), C('Extra pillow', { css: '[role=option]', has: 'Extra pillow' })]); state.mute = true; await pg.setOfflineMode(true); await env.sleep(800); },
    scroll: { spec: sheet('Create request'), block: 'end' }, targets: [C('Create request', sheet('Create request'))],
  });
  await shot(c, { slug: 'offline-queued', title: 'Saved, waiting to send', say: 'The chip says Offline and how many changes are waiting. The request shows a small cloud mark until it is sent.', keepToast: true, targets: [L('Offline chip with waiting count', { css: '.conn' }), L('Request waiting to send', row('521'))] });
  await shot(c, {
    slug: 'offline-back-online', title: 'Back online, all sent', say: 'When the connection returns the waiting requests are sent by themselves and the chip says Online again.',
    prep: async () => { await pg.setOfflineMode(false); await pg.waitForFunction(() => /Online/.test(document.querySelector('.conn')?.textContent ?? ''), { timeout: 20000 }); await env.sleep(800); state.mute = false; },
    targets: [L('Online again', { css: '.conn' }), L('Request now sent', row('521'))],
  });
  await c.page.close();
});

/* ---------- Q. A DAY AS EACH USER ---------- */
add('Q', async (env) => {
  const { shot, chapter, C, L, T, steps } = env;

  // 1. The hotel owner
  let c = await page(env, 'desktop', { role: 'owner', q: '&ack=0' });
  chapter('Q1', 'A day as the hotel owner', 'owner', 'The owner sees every area, signs the handover, reads the reports and, in Configuration, changes the lists and decides who can sign in.');
  await shot(c, { slug: 'owner-dashboard', title: 'Owner: the Dashboard', say: 'As the hotel owner you see all eleven areas. The Dashboard is the first screen, with the counts and the response times.', targets: [L('Every area', { css: '.side-list' }), L('Counts', { css: '.db-card', nth: 0 }), C('Reports', side(env, 'Reports'))] });
  await shot(c, { slug: 'owner-report', title: 'Owner: check the reports', say: 'As the hotel owner, open Reports and choose a report, for example the KPI dashboard, to see the figures for the period.', scroll: { spec: { css: '.rp-tile', has: 'KPI Dashboard' }, block: 'center' }, targets: [L('The six reports', { css: '.rp-tile', nth: 0 }), C('KPI Dashboard', { css: '.rp-tile', has: 'KPI Dashboard' })] });
  await shot(c, { slug: 'owner-report-kpi', title: 'Owner: the key figures', say: 'As the hotel owner, the key figures are shown next to the period before, with the change.', targets: [L('The figures', { text: 'Tickets logged', words: true }), C('Dashboard', side(env, 'Dashboard'))] });
  await shot(c, { slug: 'owner-handover', title: 'Owner: sign the handover', say: 'As the hotel owner, read the handover panel on the Dashboard and tap Acknowledge handover.', scroll: { spec: scr('Acknowledge handover'), block: 'end' }, targets: [C('Acknowledge handover', scr('Acknowledge handover'))] });
  await shot(c, { slug: 'owner-handover-signed', title: 'Owner: handover signed', say: 'As the hotel owner, you see that the handover is signed with the name and the time.', scroll: { spec: { css: '.banner.ok' }, block: 'center' }, targets: [L('Who signed and when', { css: '.banner.ok' }), C('Configuration', side(env, 'Configuration'))] });
  await shot(c, { slug: 'owner-edit-department', title: 'Owner: rename a department', say: 'As the hotel owner, open Configuration, tap Edit on Departments and change a name, for example IT to IT Support.', prep: (p) => steps(p, [C('Edit Departments & Staff', cfgLink('Edit Departments & Staff'))]), scroll: { spec: { css: '.le-item input[id$="-label"]', nth: 2, within: '.sheet' }, block: 'center' }, targets: [T('Department name', { css: '.le-item input[id$="-label"]', nth: 2 }, 'IT Support'), C('Save changes', sheet('Save'))] });
  await shot(c, { slug: 'owner-department-saved', title: 'Owner: department saved', say: 'As the hotel owner, you see a message that the list was saved. Every phone gets the new name.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Close', sheet('Close'))] });
  await shot(c, { slug: 'owner-add-login', title: 'Owner: add a manager login', say: 'As the hotel owner, give a manager a login: open Logins, type the name and email and choose Manager. They get an email to choose a password.', prep: (p) => steps(p, [C('Logins', cfgLink('Logins'))]), scroll: { spec: { css: '#lg-email' }, block: 'center' }, targets: [T('Name', { css: '#lg-name' }, 'Dennis Lim'), T('Email', { css: '#lg-email' }, 'dennis.lim@example.test'), C('Role', { css: '#lg-role', value: 'manager' }), C('Add login', { btn: 'Add login', within: 'form' })] });
  await shot(c, { slug: 'owner-login-added', title: 'Owner: the login is added', say: 'As the hotel owner, you see the new manager in the list. You can switch the login off at any time.', keepToast: true, scroll: { spec: { css: '.row', has: 'dennis.lim@example.test' }, block: 'center' }, targets: [L('The new manager login', { css: '.row', has: 'dennis.lim@example.test' })] });
  await c.page.close();

  // 2. The manager
  c = await page(env, 'desktop', { role: 'manager' });
  chapter('Q2', 'A day as the manager', 'manager', 'The manager runs the desk, handles a safety alert and looks after the staff list and the hold reasons, but has no Logins section.');
  await shot(c, { slug: 'manager-dashboard', title: 'Manager: the Dashboard', say: 'As a manager you run the desk. You see all eleven areas and the same Dashboard as everyone else.', targets: [L('Every area', { css: '.side-list' }), L('Signed in as manager', { css: '.side .usermenu' }), newRequest(env)] });
  await shot(c, { slug: 'manager-safety-warning', title: 'Manager: a safety warning', say: 'As a manager, when a receptionist types a worrying word, you see the same red warning before it is sent.', prep: (p) => steps(p, [T('Room number', form('Room'), '220'), T('Remark box', form('Remarks'), 'may usok sa hallway')]), scroll: { spec: { css: '.sheet .banner.bad' }, block: 'center' }, targets: [L('Safety warning', { css: '.sheet .banner.bad' }), C('Raise safety alert', sheet('Raise safety alert'))] });
  await shot(c, { slug: 'manager-safety-alert', title: 'Manager: handle the alert', say: 'As a manager, you can record that 911 was called and later sign the alert off as resolved.', targets: [L('What to do first', { css: '#sf-title', words: true }), C('I called 911 just now', { btn: 'I called 911 just now' }), C('Resolve with sign-off', { btn: 'Resolve with sign-off' })] });
  await shot(c, { slug: 'manager-crisis', title: 'Manager: the crisis log', say: 'As a manager, the alert is listed in Crisis Mgmt, where you can open a case for it and keep adding updates.', prep: async (p) => { await env.sleep(500); await steps(p, [side(env, 'Crisis Mgmt')]); }, targets: [L('Safety alerts', { css: '#alerts-title', words: true }), L('Open a case from the alert', { css: '.cr-alert-main', nth: 0 })] });
  await shot(c, { slug: 'manager-configuration', title: 'Manager: no Logins section', say: 'As a manager, Configuration has every section except Logins, because only the owner manages logins.', prep: async (p) => { await steps(p, [side(env, 'Configuration')]); }, targets: [L('Sections', { css: '.cfg-nav' }), L('Hotel profile', { css: '#cfg-profile-h', words: true })] });
  await shot(c, { slug: 'manager-add-staff', title: 'Manager: add a staff person', say: 'As a manager, add a person to the staff list with a job title, a department and a four-digit PIN.', scroll: { spec: { css: '#st-role' }, block: 'center' }, targets: [T('Full name', { css: '#st-name' }, 'Rey Mendoza'), T('Job title', { css: '#st-title' }, 'Night Engineer'), C('Department', { css: '#st-dept', value: 'engineering' }), T('Four-digit PIN', { css: '#st-pin' }, '4821'), C('Add person', { btn: 'Add person' })] });
  await shot(c, { slug: 'manager-staff-added', title: 'Manager: the person is added', say: 'As a manager, you see a message that the person was added. They can now sign in on a shared phone with their PIN.', keepToast: true, scroll: { spec: { css: '.row', has: 'Rey Mendoza' }, block: 'center' }, targets: [L('The new person', { css: '.row', has: 'Rey Mendoza' })] });
  await shot(c, { slug: 'manager-edit-hold-reason', title: 'Manager: edit a hold reason', prep: (p) => steps(p, [C('Hold Reasons', cfgLink('Hold Reasons')), C('Edit Hold Reasons', cfgLink('Edit Hold Reasons'))]), say: 'As a manager, change the wording of a hold reason so it matches how your team speaks, then save.', scroll: { spec: { css: '.le-item input[id$="-label"]', nth: 0, within: '.sheet' }, block: 'center' }, targets: [T('Hold reason name', { css: '.le-item input[id$="-label"]', nth: 0 }, 'Waiting for spare parts'), C('Save changes', sheet('Save'))] });
  await shot(c, { slug: 'manager-hold-reason-saved', title: 'Manager: hold reason saved', say: 'As a manager, you see that the change was saved for every phone.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Close', sheet('Close'))] });
  await c.page.close();

  // 3. The supervisor
  c = await page(env, 'desktop', { role: 'supervisor' });
  chapter('Q3', 'A day as the supervisor', 'supervisor', 'The supervisor works the desk and reads the reports. Configuration can be read but not changed, and there is no staff or logins section.');
  await shot(c, { slug: 'supervisor-dashboard', title: 'Supervisor: the Dashboard', say: 'As a supervisor, you start on the Dashboard and see what is open, late or on hold.', targets: [L('Open requests', { css: '.db-card', nth: 0 }), L('Overdue requests', { css: '.db-card', nth: 1 }), side(env, 'Requests')] });
  await shot(c, { slug: 'supervisor-requests', title: 'Supervisor: requests', say: 'As a supervisor, you work the request list: relay, on site, done and hold.', targets: [L('Open requests', { css: 'tbody tr', nth: 0 }), side(env, 'Work Orders')] });
  await shot(c, { slug: 'supervisor-work-orders', title: 'Supervisor: work orders', say: 'As a supervisor, you follow work orders from reported to done.', targets: [L('Stage filters', { css: '.chip', has: 'Reported' }), side(env, 'Cleaning')] });
  await shot(c, { slug: 'supervisor-cleaning', title: 'Supervisor: cleaning', say: 'As a supervisor, you see which rooms are ready to clean and who is cleaning them.', targets: [L('Status filters', { css: '.chip', has: 'Ready' }), side(env, 'Reports')] });
  await shot(c, { slug: 'supervisor-reports', title: 'Supervisor: reports', say: 'As a supervisor, you can read every report and download its CSV file.', scroll: { spec: { css: '.rp-tile', has: 'KPI Dashboard' }, block: 'center' }, targets: [L('The six reports', { css: '.rp-tile', nth: 0 }), side(env, 'Configuration')] });
  await shot(c, { slug: 'supervisor-configuration', title: 'Supervisor: Configuration to read', say: 'As a supervisor, Configuration shows how the hotel is set up, but there are no Edit buttons and no staff or logins sections.', targets: [L('Sections', { css: '.cfg-nav' }), L('Departments', { css: '#cfg-departments-h', words: true })] });
  await c.page.close();

  // 4. The shared phone: a room attendant
  c = await page(env, 'desktop', { role: 'device' });
  chapter('Q4', 'A day on the shared phone', 'device', 'A shared phone in housekeeping: pick a name, type a PIN, log a request, finish a job, clock in to clean a room and switch person.');
  await shot(c, { slug: 'shared-day-who', title: 'Shared phone: who is using it?', say: 'On the shared phone, pick your name and type your PIN.', targets: [L('Names', { css: '.people' }), ...signIn(env, 'Joel Dizon')] });
  await shot(c, { slug: 'shared-day-home', title: 'Shared phone: seven areas', say: 'On the shared phone you see only the areas a room attendant needs. Requests shows the requests for your own department first.', targets: [L('The seven areas', { css: '.side-list' }), newRequest(env)] });
  await shot(c, { slug: 'shared-day-new-request', title: 'Shared phone: new request', say: 'On the shared phone, type the room and search for what the guest needs.', prep: (p) => steps(p, [T('Room number', form('Room'), '418'), C('Item box', form('Item'))]), targets: [L('The items this person can choose', { css: '.rq-options' }), C('Extra pillow', { css: '[role=option]', has: 'Extra pillow' })] });
  await shot(c, { slug: 'shared-day-ready', title: 'Shared phone: send it', say: 'On the shared phone, tap Create request. The request is recorded under your name.', scroll: { spec: sheet('Create request'), block: 'end' }, targets: [C('Create request', sheet('Create request'))] });
  await shot(c, { slug: 'shared-day-logged', title: 'Shared phone: request logged', say: 'On the shared phone, the new request appears in your department’s list. Tap its ticket number to open it.', keepToast: true, targets: [L('The new request', row('418')), C('Open the request', { css: '.rq-code', within: row('418') })] });
  await shot(c, { slug: 'shared-day-on-site', title: 'Shared phone: mark on site', say: 'On the shared phone, tap On site when you reach the room.', targets: [C('On site', insp('On site'))] });
  await shot(c, { slug: 'shared-day-finish', title: 'Shared phone: finish the job', say: 'On the shared phone, tap Done when the pillow is delivered.', targets: [C('Done', insp('Done'))] });
  await shot(c, { slug: 'shared-day-done', title: 'Shared phone: job finished', say: 'On the shared phone, the job shows as Done with your name in its history. Cleaning is next.', targets: [L('History with your name', { css: '.insp .rq-hist' }), C('Cleaning', side(env, 'Cleaning'))] });
  await shot(c, { slug: 'shared-day-cleaning', title: 'Shared phone: clock in to a room', say: 'On the shared phone, a room attendant sees the rooms and taps Clock In when the clean starts.', targets: [L('Rooms', { css: 'tbody tr', nth: 0 }), C('Clock in room 507', scr('Clock in room 507'))] });
  await shot(c, { slug: 'shared-day-clocked-in', title: 'Shared phone: the clean has started', say: 'On the shared phone, the room is In Progress. Tap Clock Out when it is clean. Then open the person menu to hand the phone over.', targets: [L('Room in progress', { css: 'tbody tr', has: '507' }), C('Open the person menu', { css: '.side .usermenu-btn' })] });
  await shot(c, { slug: 'shared-day-switch', title: 'Shared phone: switch person', say: 'On the shared phone, tap Switch person so the next person can sign in with their own PIN.', targets: [C('Switch person', { btn: 'Switch person', within: '.usermenu-panel' })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'device' });
  await shot(p, { slug: 'phone-shared-day-home', title: 'Shared phone: the phone view', say: 'On the shared phone, the phone screen has four tabs and a big New request button.', prep: (pg) => steps(pg, signIn(env, 'Joel Dizon')), targets: [L('The tabs', { css: '.tabbar' }), L('New request', { css: '.fab' })] });
  await p.page.close();
});

/* ---------- P. EMPTY STATES (last: ?empty=1 clears the sample desk) ---------- */
add('P', async (env) => {
  const { shot, chapter, L } = env;
  const c = await page(env, 'desktop', { role: 'owner', q: '&empty=1' });
  chapter('P', 'A quiet day', 'owner', 'When there is nothing to show, each screen says what to do next.');
  await shot(c, { slug: 'empty-dashboard', title: 'A Dashboard with no work', say: 'With no work open, every count shows zero and the table of latest requests says what to do next.', targets: [L('Counts at zero', { css: '.db-card', nth: 0 }), L('Nothing yet', { css: '.empty' }), side(env, 'Requests')] });
  await shot(c, { slug: 'empty-requests', title: 'No requests', say: 'When no request is open, the list says so and offers a New request button.', targets: [L('Nothing open', { css: '.empty' }), side(env, 'Reports')] });
  await shot(c, { slug: 'empty-reports', title: 'Reports on a quiet day', say: 'On a quiet day, Today at a glance shows zero and the reports are ready for when there is something to count.', targets: [L('Today at a glance', { css: '.rp-h2', has: 'Today at a glance', words: true }), L('Counts at zero', { text: 'Tickets logged this shift', words: true })] });
  await c.page.close();
  const p = await page(env, 'phone', { role: 'owner', q: '&empty=1' });
  await shot(p, { slug: 'phone-empty-requests', title: 'A quiet day on a phone', say: 'On a phone, an empty list invites you to log the first request.', prep: (pg) => env.steps(pg, [env.C('Open Requests', { btn: 'Requests', within: '.tabbar' })]), targets: [L('Nothing open', { css: '.empty' }), L('New request button', { css: '.fab' })] });
  await p.page.close();
});
