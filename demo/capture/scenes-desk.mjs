// Chapters C (Requests), D (working on a request) and E (safety alerts) on the owner desk.
import { add, main, side, newRequest, scr, goTo, ROOM } from './chapters.mjs';

export const sheet = (name, extra = {}) => ({ btn: name, within: '.sheet', ...extra });
export const NEEDS = { spec: { text: 'What they need', within: '.sheet' }, block: 'start' };
export const insp = (name, extra = {}) => ({ btn: name, within: '.insp', ...extra });
/** A request row in the table (or the card list when a drawer is open), found by its room. */
export const row = (room) => ({ css: 'tr, .rq-card', has: room });
const code = (c) => ({ css: '.rq-code, .rq-card-main', has: c });
/** The ticket button of the row for a room. */
const codeOfRoom = (room) => ({ css: '.rq-code, .rq-card-main', within: { css: 'tr, .rq-card', has: room } });

add('C', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const c = await main(env);
  chapter('C', 'Requests', 'owner', 'Every guest request in one list, with its tabs and search. A guest calls, the receptionist taps the room, chooses what the guest needs and sends it to the right team.');
  await shot(c, {
    slug: 'requests-list', title: 'All guest requests', say: 'The Requests list shows every request with its room, department, status and how long each step took. Late steps are shown in red.', prep: goTo(env, 'Requests'),
    targets: [L('Tabs for all, active and done', scr('Active')), L('Quick filters', { css: '.chip', has: 'Overdue' }), L('Search box', { css: '#rq-q' }), L('First request', code('T-0108-1')), C('Overdue filter', scr('Overdue'))],
  });
  await shot(c, { slug: 'requests-overdue', title: 'Overdue requests only', say: 'The Overdue filter shows only the requests that took longer than their own target time.', targets: [L('A late request', { css: 'tbody tr', nth: 0 }), C('Turn Overdue off', scr('Overdue')), C('On hold filter', scr('On hold'))] });
  await shot(c, { slug: 'requests-on-hold', title: 'Requests waiting on something', say: 'A request that has to wait, for example a guest who does not want to be disturbed, is parked here and its timer stops.', targets: [L('A request on hold', { css: 'tbody tr', nth: 0 }), C('Turn On hold off', scr('On hold')), C('Done tab', scr('Done'))] });
  await shot(c, { slug: 'requests-done', title: 'Finished requests', say: 'The Done tab keeps everything that has been finished, with the time each step took.', targets: [L('A finished request', { css: 'tbody tr', nth: 0 }), C('Active tab', scr('Active'))] });
  await shot(c, { slug: 'requests-search', title: 'Search the list', say: 'Type a room, an item, a ticket number or a name to find a request at once.', targets: [T('Search box', { css: '#rq-q' }, '412')] });
  await shot(c, { slug: 'requests-search-result', title: 'Only room 412', say: 'Only the matching requests stay in the list. Clear the box to see everything again.', targets: [L('Matching requests', { css: 'tbody tr', nth: 0 }), T('Clear the search', { css: '#rq-q' }, ''), newRequest(env)] });
  const form = (name) => ({ field: name, within: '.sheet' });
  await shot(c, {
    slug: 'new-request-room', title: 'Type the room number', say: 'The New request form opens with the room box ready. Type the room number, or tap one of the rooms used a moment ago.',
    targets: [L('Who is asking', form('Requested by')), L('Rooms used recently', { css: '.sheet [aria-label="Recent rooms"]' }), T('Room number', form('Room'), '608')],
  });
  await shot(c, {
    slug: 'new-request-item', title: 'Search for what the guest needs', say: 'Click the item box and type to search, or pick from the list. Each item shows the department that will handle it.',
    prep: (p) => steps(p, [C('Item box', form('Item'))]), targets: [L('Item box', form('Item')), C('Extra towels', { css: '[role=option]', has: 'Extra towels' })],
  });
  await shot(c, {
    slug: 'new-request-quantity', title: 'How many, and who does it', say: 'Set how many are needed. The team is filled in for you, and a person can be picked if you already know who will do it.',
    scroll: { spec: form('Qty'), block: 'center' }, targets: [C('One more towel', { btn: 'One more', within: '.sheet' }), L('Department queue', form('Assign')), L('Add another item', sheet('Add item')), L('A bundle for bigger problems', sheet('Leak bundle'))],
  });
  await shot(c, {
    slug: 'new-request-remark', title: 'Add a short remark', say: 'If it helps, add a short note for the team. This step is optional.',
    scroll: { spec: form('Remarks'), block: 'center' }, targets: [T('Remark box', form('Remarks'), 'Two extra bath towels, please')],
  });
  await shot(c, {
    slug: 'new-request-ready', title: 'Create the request', say: 'Check the room and the item, then tap Create request. It goes straight to the right team.',
    scroll: { spec: sheet('Create request'), block: 'end' }, targets: [L('VIP guest switch', sheet('VIP guest')), L('Optional room-only button', sheet('Log it later (room only)')), C('Create request', sheet('Create request'))],
  });
  await shot(c, {
    slug: 'requests-new-item', title: 'New request is in the list', say: 'The request appears at once in the list and the team is told. A short message confirms it was sent.', keepToast: true,
    targets: [L('The new request', row('608')), L('Confirmation message', { css: '.toast' }), newRequest(env)],
  });
  await shot(c, {
    slug: 'new-request-room-only', title: 'Save just the room for later', say: 'When the guest is still talking, type only the room number and tap Log it later. Add what they need afterwards.',
    prep: (p) => steps(p, [T('Room number', form('Room'), '905')]), scroll: { spec: sheet('Log it later (room only)'), block: 'end' },
    targets: [C('Log it later (room only)', sheet('Log it later (room only)'))],
  });
  await shot(c, {
    slug: 'requests-finish-logging', title: 'Rooms waiting to be finished', say: 'A room saved without details is marked Finish logging until someone adds what the guest needs.', keepToast: true,
    targets: [L('Finish logging mark', { css: '.st', has: 'Finish logging' }), C('Add items', { btn: 'Add items', within: row('905') })],
  });
  await shot(c, {
    slug: 'detail-finish-logging', title: 'Add what the guest needs', say: 'Open the saved room, tap what the guest needs and add it to the ticket.',
    targets: [L('What to add', { css: '.insp .group-title', has: 'Finish logging', words: true }), C('Room cleaning', { css: '.insp .chip', has: 'Room cleaning' })],
  });
  await shot(c, {
    slug: 'detail-finish-logging-ready', title: 'Add it to the ticket', say: 'With the need chosen, tap Add to ticket.',
    scroll: { spec: insp('Add to ticket'), block: 'end' }, targets: [C('Add to ticket', insp('Add to ticket'))],
  });
  await shot(c, { slug: 'requests-finished-logging', title: 'The room is now complete', say: 'Once the need is added, the request goes to the team like any other.', targets: [L('The completed request', row('905')), C('Close details', insp('Close details')), newRequest(env)] });
  await shot(c, {
    slug: 'new-request-bundle', title: 'A bundle for bigger problems', say: 'Some problems need two teams. Type the room and tap the Leak bundle to create both jobs at once.',
    prep: (p) => steps(p, [T('Room number', form('Room'), '316')]), scroll: { spec: sheet('Leak bundle'), block: 'center' }, targets: [C('Leak bundle', sheet('Leak bundle'))],
  });
  await shot(c, {
    slug: 'new-request-bundle-chosen', title: 'The bundle explains itself', say: 'A line under the buttons says which teams will work and in which order.',
    scroll: { spec: { css: '.sheet .field-help', has: 'Later steps' }, block: 'center' }, targets: [L('What the bundle does', { css: '.sheet .field-help', has: 'Later steps' }), C('Create request', sheet('Create request'))],
  });
  await shot(c, {
    slug: 'requests-bundle', title: 'Two jobs from one request', say: 'The Leak request shows both teams. Engineering fixes the source first, then Housekeeping cleans up.', keepToast: true,
    targets: [L('The two jobs', row('316')), C('Open the leak ticket', codeOfRoom('316'))],
  });
  await shot(c, {
    slug: 'detail-bundle', title: 'The second job waits its turn', say: 'The clean-up job waits and its timer does not run until the repair is finished.',
    targets: [L('Clean-up waits for the repair', { css: '.insp .rq-strip' }), C('Close details', insp('Close details'))],
  });
});

add('D', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('D', 'Working on a request', 'owner', 'Open a request, send it to its team, mark it on site and done, park it, move it to another team or turn it into a work order.');
  await shot(c, { slug: 'requests-pick-one', title: 'Pick a request to open', say: 'Tap a ticket number to see its details on the right. The buttons at the end of each row do the next step quickly.', prep: goTo(env, 'Requests'), targets: [L('Quick step button', { btn: 'Relay: T-0108-1' }), C('Open ticket T-0108', code('T-0108-1'))] });
  await shot(c, {
    slug: 'detail-new', title: 'A new request opens', say: 'The details show what was asked, which team has it and a timer. A new request starts by being relayed to its team.',
    targets: [L('Facts about the ticket', { css: '.insp .rq-facts' }), L('Timers', { css: '.insp .rq-meta', nth: 1 }), C('Relay to the team', insp('Relay'))],
  });
  await shot(c, { slug: 'detail-relayed', title: 'Relayed to the team', say: 'Once the team has it, the next step is to mark when someone is at the room.', targets: [L('Who relayed it', { css: '.insp .rq-meta', nth: 0 }), C('Mark as on site', insp('On site'))] });
  await shot(c, { slug: 'detail-on-site', title: 'Someone is at the room', say: 'While work is going on, Done closes the request. If the guest cannot be served yet, it can be put on hold.', targets: [L('Done button', insp('Done')), C('Put on hold', insp('Hold'))] });
  await shot(c, { slug: 'detail-hold-reasons', title: 'Why is it waiting?', say: 'Choose the reason it has to wait. The timer stops so the team is not marked late.', targets: [C('Guest on Do Not Disturb', { btn: 'Guest on Do Not Disturb', within: '.sheet' })] });
  await shot(c, { slug: 'detail-on-hold', title: 'On hold, timer paused', say: 'The request shows why it is on hold and that its clock is paused. Resume it when the guest is ready.', targets: [L('Reason and paused clock', { css: '.insp .rq-strip' }), C('Resume', insp('Resume'))] });
  await shot(c, { slug: 'detail-resumed', title: 'Back at work', say: 'After Resume the timer runs again from where it stopped. Tap Done when the work is finished.', targets: [C('Done', insp('Done'))] });
  await shot(c, { slug: 'detail-done', title: 'A finished request', say: 'The request shows as Done and its history lists every step with the time and who did it.', targets: [L('History of every step', { css: '.insp .rq-hist' }), C('Hand off to another team', insp('Hand off'))] });
  await shot(c, { slug: 'detail-hand-off', title: 'Hand a job to another team', scroll: { spec: insp('Hand off', { nth: -1 }), block: 'end' }, say: 'When one team finishes and another must follow up, tap Hand off, choose the department and add a note. A new request is made for them.', targets: [C('Department', { field: 'Department', within: '.insp', value: 'housekeeping' }), T('Note', { field: 'Note', within: '.insp' }, 'Guest wants the tray table cleaned too'), C('Hand off', insp('Hand off', { nth: -1 }))] });
  await shot(c, { slug: 'detail-handed-off', title: 'The follow-up is created', say: 'The history says the job was handed off and the other team has its own new request.', targets: [L('History shows the hand off', { css: '.insp .rq-hist' }), C('Edit the item', insp('Edit T-0108-1'))] });
  await shot(c, { slug: 'detail-edit-item', title: 'Change the request details', say: 'Edit changes the department, the item, the quantity, who it is assigned to or the remarks.', targets: [L('Department', { field: 'Department', within: '.sheet' }), T('Remarks', { field: 'Remarks', within: '.sheet' }, 'Guest wants it by 9 pm'), C('Save changes', sheet('Save changes'))] });
  await shot(c, { slug: 'detail-transfer', title: 'Move a request to another team', prep: (p) => env.steps(p, [C('Close details', insp('Close details')), C('Open ticket T-0101', code('T-0101-1'))]), say: 'If the wrong team has the request, tap Transfer to send it to another department.', targets: [C('Transfer', insp('Transfer'))] });
  await shot(c, { slug: 'detail-transfer-choices', title: 'Choose the new team', scroll: { spec: insp('Transfer', { nth: -1 }), block: 'end' }, say: 'Pick the department that should take over. A reason is optional.', targets: [C('Front Desk', { field: 'To department', within: '.insp', value: 'frontdesk' }), T('Reason', { field: 'Reason', within: '.insp' }, 'Guest collects at the desk'), C('Transfer', insp('Transfer', { nth: -1 }))] });
  await shot(c, { slug: 'detail-transferred', title: 'The request moved', say: 'The old line shows it was transferred and a new line appears for the new team.', targets: [L('Moved to another team', { css: '.insp .rq-itm', nth: 0 }), C('Close details', insp('Close details'))] });
  await shot(c, { slug: 'detail-work-order', title: 'Needs a work order', prep: (p) => env.steps(p, [C('Open ticket T-0102', codeOfRoom('305'))]), say: 'A bigger repair, like an air conditioner that stays warm, can become a work order that is tracked until it is finished.', targets: [C('Turn it into a work order', insp('Work order'))] });
  await shot(c, { slug: 'detail-work-order-made', title: 'Now a work order', say: 'The request now says it is tracked as a work order. You can open it or undo the step.', targets: [L('Undo the work order', insp('Undo work order')), C('Open the work order', insp('WO-'))] });
});

add('E', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const c = await main(env);
  chapter('E', 'Safety alerts', 'owner', 'Words that point to danger raise a warning. The alert tells everyone to call 911 or use the radio first, then records who called.');
  await shot(c, {
    slug: 'safety-remark', title: 'A worrying word in a remark', say: 'If the remark mentions smoke, fire or another danger, even in Tagalog, the desk notices while the receptionist types.',
    prep: async (p) => { await steps(p, [side(env, 'Requests'), newRequest(env)]); await env.sleep(500); await steps(p, [T('Room number', { field: 'Room', within: '.sheet' }, '810')]); }, scroll: { spec: { field: 'Remarks', within: '.sheet' }, block: 'center' },
    targets: [T('Remark box', { field: 'Remarks', within: '.sheet' }, 'may usok sa hallway')],
  });
  await shot(c, {
    slug: 'safety-warning', title: 'Safety warning before sending', say: 'A red warning appears before anything is sent. It says to call for help first, then log.',
    scroll: { spec: { css: '.sheet .banner.bad' }, block: 'center' }, targets: [L('Safety warning', { css: '.sheet .banner.bad' }), L('False alarm button', sheet('False alarm, clear')), C('Raise safety alert', sheet('Raise safety alert'))],
  });
  await shot(c, {
    slug: 'safety-alert', title: 'The safety alert screen', say: 'Everyone signed in sees this alert within seconds. It says to call 911 or the radio first.',
    targets: [L('What to do first', { css: '#sf-title', words: true }), L('Who has been told', { text: 'Staff notified (not BFP/911)' }), C('I called 911 just now', { btn: 'I called 911 just now' })],
  });
  await shot(c, {
    slug: 'safety-911-recorded', title: 'Who called 911 and when', say: 'One tap records that 911 was called, by whom and at what time.',
    targets: [L('Who called and when', { text: 'Recorded:' }), C('Acknowledge and keep open', { btn: 'Acknowledge and keep open' })],
  });
  await shot(c, {
    slug: 'requests-safety-banner', title: 'Alert banner on the request list', say: 'While the alert is open, a red banner stays at the top of the request list for everyone.',
    targets: [C('The red alert banner', { css: 'button.banner.bad' })],
  });
  await shot(c, {
    slug: 'safety-resolve', title: 'Closing the alert safely', say: 'When the danger is over, a manager or the owner signs the alert off. A false alarm can be lowered instead.',
    targets: [L('Lower to a false alarm', { btn: 'Downgrade to false alarm (logged)' }), C('Resolve with sign-off', { btn: 'Resolve with sign-off' })],
  });
  await shot(c, {
    slug: 'safety-second-alert', title: 'A second alert, lowered', say: 'Another report, this time a gas smell. Here it turns out to be a false alarm, so it is lowered and the note stays in the log.',
    prep: async (p) => { await env.sleep(600); await steps(p, [newRequest(env), T('Room number', { field: 'Room', within: '.sheet' }, '712'), T('Remark box', { field: 'Remarks', within: '.sheet' }, 'amoy gas sa kwarto'), C('Raise safety alert', sheet('Raise safety alert'))]); },
    targets: [L('Safety words found', { css: '#sf-title', words: true }), C('Downgrade to false alarm', { btn: 'Downgrade to false alarm (logged)' })],
  });
});
