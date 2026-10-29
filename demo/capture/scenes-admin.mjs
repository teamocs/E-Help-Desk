// Chapters K (settings and staff), L (logins), M (lists) and O (offline) on the owner desk.
import { add, main, side, newRequest, ROOM } from './chapters.mjs';
import { sheet, NEEDS } from './scenes-desk.mjs';

const title = (t) => ({ css: '.group-title', has: t });
const label = (nth) => ({ css: '.le-item input[id$="-label"]', nth });

add('K', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('K', 'Settings and staff', 'owner', 'Text size, contrast and sounds, and the list of staff who sign in with a PIN.');
  await shot(c, {
    slug: 'settings-staff', title: 'Staff who use a PIN', say: 'Staff sign in on a shared phone with a four-digit PIN. A manager can set a new PIN or remove a person here.',
    targets: [L('Staff list', { ...title('Staff'), words: true }), L('Remove a person', { btn: 'Remove Joel Dizon' }), C('Set a new PIN', { btn: 'Set a new PIN for Joel Dizon' })],
  });
  await shot(c, { slug: 'settings-set-pin', title: 'Set a new PIN', say: 'Type four digits and tap Save. The PIN is never shown again, so write down a new one if it is forgotten.', targets: [T('New PIN', { btn: 'New PIN for Joel Dizon' }, '4821'), L('Save the PIN', { btn: 'Save', within: { css: '.row', has: 'Joel Dizon' } })] });
  await shot(c, {
    slug: 'settings-add-person', title: 'Add a person', say: 'To add someone, type their name, pick a job title, a role and a department, and give them a four-digit PIN.',
    scroll: { spec: { css: '#st-role' }, block: 'center' },
    targets: [T('Full name', { css: '#st-name' }, 'Dennis Lim'), T('Job title', { css: '#st-title' }, 'Night Engineer'), C('Department', { css: '#st-dept', value: 'engineering' }), T('Four-digit PIN', { css: '#st-pin' }, '4821'), L('Add person button', { btn: 'Add person' })],
  });
  await shot(c, {
    slug: 'settings-display', title: 'Text size and contrast', say: 'Make the text bigger, increase the contrast or reduce movement so the screen is comfortable to read, even at 3 a.m.',
    scroll: { spec: title('Display'), block: 'start' },
    targets: [L('Reduce motion', { btn: 'Reduce motion' }), L('Higher contrast', { btn: 'Increase contrast' }), C('Larger text', { css: '#ts', keys: ['ArrowRight', 'ArrowRight'] })],
  });
  await shot(c, { slug: 'settings-text-larger', title: 'Larger text', say: 'Everything on the screen is now larger. The change is only for this device.', scroll: { spec: title('Display'), block: 'start' }, targets: [C('Higher contrast', { btn: 'Increase contrast' })] });
  await shot(c, {
    slug: 'settings-contrast', title: 'Higher contrast', say: 'Higher contrast makes text and lines stronger. Switch it off again the same way.', scroll: { spec: title('Display'), block: 'start' },
    targets: [C('Contrast off', { btn: 'Increase contrast' }), C('Normal text size', { css: '#ts', keys: ['ArrowLeft', 'ArrowLeft'] })],
  });
  await shot(c, { slug: 'settings-feel', title: 'Vibration and sounds', say: 'Choose whether the phone vibrates and whether safety alerts make a sound. Keyboard shortcuts can be turned off too.', scroll: { spec: title('Feel'), block: 'start' }, targets: [L('Vibration', { btn: 'Vibration' }), L('Sounds', { btn: 'Sounds' }), L('Keyboard shortcuts', { btn: 'Keyboard shortcuts' })] });
});

add('L', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('L', 'Logins for managers', 'owner', 'Only the hotel owner decides who can sign in with an email address, and can switch a login off.');
  await shot(c, { slug: 'logins-list', title: 'People who sign in with email', say: 'The owner sees everyone who signs in with an email: managers, supervisors and shared phones.', scroll: { spec: title('Logins'), block: 'start' }, targets: [L('The logins list', { css: '.group-title', has: 'Logins', words: true }), C('Switch off a login', { btn: 'Switch off Ana Villanueva' })] });
  await shot(c, { slug: 'logins-switched-off', title: 'A login switched off', say: 'A switched-off person is signed out everywhere and cannot sign in until the owner switches them on again.', scroll: { spec: title('Logins'), block: 'start' }, targets: [L('Switched off label', { css: '.pill.warn', has: 'Switched off' }), C('Switch it on again', { btn: 'Switch on Ana Villanueva' })] });
  await shot(c, {
    slug: 'logins-add', title: 'Add a login', say: 'To give someone a login, type their name and email and choose their role. They get an email to set their own password.',
    scroll: { spec: { css: '#lg-email' }, block: 'center' },
    targets: [T('Name', { css: '#lg-name' }, 'Liza Abad'), T('Email', { css: '#lg-email' }, 'liza.abad@example.test'), C('Role', { css: '#lg-role', value: 'supervisor' }), C('Add login', { btn: 'Add login', within: 'form' })],
  });
  await shot(c, { slug: 'logins-added', title: 'The new login is listed', say: 'The new person appears in the list and is emailed a link to choose a password.', keepToast: true, scroll: { spec: title('Logins'), block: 'start' }, targets: [L('The new login', { css: '.row', has: 'Liza Abad' })] });
});

const openList = (env, name) => env.C(`Open ${name}`, { btn: name });
const closeSheet = (env) => env.C('Close the list', sheet('Close'));

add('M', async (env) => {
  const { shot, chapter, C, L, T, steps } = env;
  const c = await main(env);
  chapter('M', 'Your own lists', 'owner', 'The hotel chooses its own departments, request types, bundles, hold reasons, job titles and repair findings.');
  await shot(c, { slug: 'lists-overview', title: 'The hotel’s own lists', say: 'Six lists let the hotel decide its own wording. Changes reach every phone within a few seconds.', scroll: { spec: title('Lists'), block: 'start' }, targets: [L('Lists section', { ...title('Lists'), words: true }), openList(env, 'Departments')] });
  await shot(c, { slug: 'lists-departments', title: 'Departments', say: 'Each department has a name, a short badge and a choice for whether it handles repairs. A note shows how much it is used.', targets: [L('Badge shown in lists', { css: '.le-item input[id$="-short"]', nth: 0 }), L('Handles repairs', { css: '.le-check', nth: 1 }), L('How much it is used', { text: 'In use:', within: '.sheet' }), C('Add a department', sheet('Add department'))] });
  await shot(c, { slug: 'lists-department-new', title: 'A new department', say: 'Type the name of the new department, for example Spa.', scroll: { spec: { css: '.le-item', nth: -1, within: '.sheet' }, block: 'center' }, targets: [T('Department name', label(-1), 'Spa')] });
  await shot(c, { slug: 'lists-department-ready', title: 'Save the department', say: 'A short badge is filled in for you. Save the changes to make the department available everywhere.', prep: (p) => steps(p, [C('Blur', { css: '.sheet h2' })]), scroll: { spec: { css: '.le-item', nth: -1, within: '.sheet' }, block: 'center' }, targets: [L('Badge', { css: '.le-item input[id$="-short"]', nth: -1 }), C('Save changes', sheet('Save changes'))] });
  await shot(c, { slug: 'lists-department-saved', title: 'Department saved', say: 'A message confirms the list was saved and the button says Saved.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), C('Try to delete Housekeeping', sheet('Delete Housekeeping'))] });
  await shot(c, { slug: 'lists-in-use-refusal', title: 'A used department cannot be deleted', say: 'A department that people or requests still use cannot be deleted. The message suggests archiving it instead.', scroll: { spec: { css: '.le-item', nth: 0, within: '.sheet' }, block: 'start' }, targets: [L('Why it cannot be deleted', { css: '.le-error' }), C('Archive Housekeeping', sheet('Archive Housekeeping'))] });
  await shot(c, { slug: 'lists-department-archived', title: 'Archived instead', say: 'An archived department is hidden from new work but keeps its name on old requests. It can be restored at any time.', targets: [L('Archived label', { css: '.pill.warn', has: 'Archived' }), closeSheet(env)] });
  await shot(c, { slug: 'lists-request-types-open', title: 'Request types', say: 'Request types are the buttons receptionists tap. Each has a department, a target time in minutes and an icon.', prep: (p) => steps(p, [openList(env, 'Request types')]), targets: [L('Department and target time', { css: '.le-grid', nth: 0 }), L('Icon of the request', { css: '.le-icon-line', nth: 0 }), C('Add a request type', sheet('Add request type'))] });
  await shot(c, {
    slug: 'lists-request-type-new', title: 'A new request type', say: 'Name the request, choose the Spa department and the target time. Then choose an icon.', scroll: { spec: { css: '.le-item', nth: -1, within: '.sheet' }, block: 'start' },
    targets: [T('Request name', label(-1), 'Massage booking'), C('Department', { css: '.le-item select[id$="-dept"]', nth: -1, value: 'spa' }), T('Target in minutes', { css: '.le-item input[id$="-sla"]', nth: -1 }, '60'), C('Change the icon', { css: '.le-icon-line button', nth: -1 })],
  });
  await shot(c, { slug: 'lists-icon-picker', title: 'Pick an icon', say: 'Tap the picture that fits the request. Here the Spa icon.', scroll: { spec: { css: '.icon-grid' }, block: 'center' }, targets: [C('Spa icon', { css: '.icon-opt', has: 'Spa' })] });
  await shot(c, { slug: 'lists-request-type-ready', title: 'Save the request type', say: 'The icon is chosen. Save to add Massage booking to the New request screen.', scroll: { spec: sheet('Save changes'), block: 'end' }, targets: [C('Save changes', sheet('Save changes'))] });
  await shot(c, { slug: 'lists-request-type-saved', title: 'Request type saved', say: 'The new request type is saved for every phone.', keepToast: true, targets: [L('Saved message', { css: '.toast' }), closeSheet(env)] });
  await shot(c, { slug: 'new-request-with-spa', title: 'The new button is there', say: 'Back on the New request screen, Massage booking is now one of the buttons.', prep: (p) => steps(p, [newRequest(env)]), scroll: { spec: sheet('Massage booking'), block: 'center' }, targets: [L('Massage booking button', sheet('Massage booking'))] });
  await shot(c, { slug: 'lists-bundles', title: 'Bundles with steps', say: 'A bundle creates several jobs at once. Each step names its department and a later step can wait for an earlier one.', prep: (p) => steps(p, [C('Close', sheet('Close')), openList(env, 'Bundles')]), targets: [L('Steps of the bundle', { css: '.le-steps' }), L('Waits for the step before', { text: 'Starts after step 1 is done', within: '.sheet' }), C('Add a step', sheet('Add a step'))] });
  await shot(c, { slug: 'lists-hold-reasons', title: 'Reasons to put on hold', say: 'These are the reasons shown when a request has to wait. A note shows which ones are in use right now.', prep: (p) => steps(p, [closeSheet(env), openList(env, 'Hold reasons')]), targets: [L('In use right now', { text: 'In use:', within: '.sheet' }), closeSheet(env)] });
  await shot(c, { slug: 'lists-job-titles', title: 'Job titles', say: 'Job titles are suggested when a person is added to the staff list.', prep: (p) => steps(p, [openList(env, 'Job titles')]), targets: [L('The job titles', { css: '.le-list' }), closeSheet(env)] });
  await shot(c, { slug: 'lists-repair-findings', title: 'Repair findings', say: 'These quick answers appear when someone assesses a repair job.', prep: (p) => steps(p, [openList(env, 'Work-order findings')]), targets: [L('The findings', { css: '.le-list' }), closeSheet(env)] });
});

add('O', async (env) => {
  const { shot, chapter, C, L, digits, steps, state } = env;
  const c = await main(env);
  const { page } = c;
  chapter('O', 'No internet', 'owner', 'When the connection drops, the desk keeps working and sends everything when it is back.');
  await shot(c, {
    slug: 'offline-new-request', title: 'Logging with no internet', say: 'Even with the internet cut, a request can still be logged. The desk keeps it safe on the phone.',
    prep: async (p) => { await steps(p, [side(env, 'Requests'), newRequest(env)]); await env.sleep(500); await steps(p, [...digits('521', ROOM)]); await steps(p, [C('Extra pillow', sheet('Extra pillow'))]); state.mute = true; await page.setOfflineMode(true); await env.sleep(800); },
    scroll: { spec: sheet('Log request'), block: 'end' }, targets: [C('Log request', sheet('Log request'))],
  });
  await shot(c, { slug: 'offline-queued', title: 'Saved, waiting to send', say: 'The chip says Offline and how many changes are waiting. The request shows a small cloud mark until it is sent.', keepToast: true, targets: [L('Offline chip with waiting count', { css: '.conn' }), L('Request waiting to send', { css: '.ticket', has: '521' })] });
  await shot(c, {
    slug: 'offline-back-online', title: 'Back online, all sent', say: 'When the connection returns the waiting requests are sent by themselves and the chip says Online again.',
    prep: async () => { await page.setOfflineMode(false); await page.waitForFunction(() => /Online/.test(document.querySelector('.conn')?.textContent ?? ''), { timeout: 20000 }); await env.sleep(800); state.mute = false; },
    targets: [L('Online again', { css: '.conn' }), L('Request now sent', { css: '.ticket', has: '521' })],
  });
});
