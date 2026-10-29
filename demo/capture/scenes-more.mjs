// Chapters D (a request), F (work orders), G (housekeeping), H (handover), I (insights) on the owner desk, and PH (phone).
import { add, main, side, newRequest, ROOM, deskUrl } from './chapters.mjs';
import { sheet, NEEDS } from './scenes-desk.mjs';

const insp = (name, extra = {}) => ({ btn: name, within: '.insp', ...extra });
const row = (room) => ({ css: '.ticket', has: room });
const HK = (room) => ({ css: '.row', has: room });

add('D', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await main(env);
  chapter('D', 'Working on a request', 'owner', 'Open a request, send it to the team, mark it on site and done, park it, move it or turn it into a repair job.');
  await shot(c, { slug: 'requests-pick-one', title: 'Pick a request to open', say: 'Tap any request in the list to see its details on the right.', targets: [C('Room 608 towels', row('608'))] });
  await shot(c, {
    slug: 'detail-new', title: 'A new request opens', say: 'The details show what was asked, which team has it and a timer. A new request starts by being sent to its team.',
    targets: [L('History of the request', { css: '.insp .timeline' }), C('Send to the team', insp('Relay'))],
  });
  await shot(c, { slug: 'detail-sent', title: 'Sent to the team', say: 'Once the team has it, the next step is to mark when someone is at the room.', targets: [C('Mark as on site', insp('On site'))] });
  await shot(c, { slug: 'detail-on-site', title: 'Someone is at the room', say: 'While work is going on, Done closes the request. If the guest cannot be served yet, it can be put on hold.', targets: [L('Done button', insp('Done')), C('Put on hold', insp('Hold…'))] });
  await shot(c, { slug: 'detail-hold-reasons', title: 'Why is it waiting?', say: 'Choose the reason it has to wait. The timer stops so the team is not marked late.', targets: [C('Guest on Do Not Disturb', insp('Guest on Do Not Disturb'))] });
  await shot(c, { slug: 'detail-on-hold', title: 'On hold, timer paused', say: 'The request shows why it is on hold and that its clock is paused. Resume it when the guest is ready.', targets: [L('Reason and paused clock', { text: 'The clock is paused', within: '.insp' }), C('Resume', insp('Resume'))] });
  await shot(c, { slug: 'detail-resumed', title: 'Back at work', say: 'After Resume the timer runs again from where it stopped. Tap Done when the work is finished.', targets: [C('Done', insp('Done'))] });
  await shot(c, { slug: 'detail-done', title: 'A finished request', say: 'The request shows as Done and its history lists every step with the time and who did it.', targets: [L('History of every step', { css: '.insp .timeline' }), C('Done tab', { btn: 'Done', within: '.seg' })] });
  await shot(c, { slug: 'requests-done-list', title: 'Finished requests are kept', say: 'Finished requests move to the Done tab so the Open list stays short.', targets: [L('The finished request', row('608')), C('Open tab', { btn: 'Open', within: '.seg' })] });
  await shot(c, { slug: 'detail-tray-pickup', title: 'Move a request to another team', prep: (p) => env.steps(p, [C('Tray pickup request', row('614'))]), say: 'If the wrong team has the request, tap Transfer to send it to another department.', targets: [C('Transfer', insp('Transfer…'))] });
  await shot(c, { slug: 'detail-transfer-choices', title: 'Choose the new team', say: 'Pick the department that should take over.', targets: [C('Housekeeping', insp('Housekeeping'))] });
  await shot(c, { slug: 'detail-transferred', title: 'The request moved', say: 'The old line shows it was transferred and a new line appears for the new team.', targets: [L('Moved to another team', { text: 'transferred in', within: '.insp' }), C('AC not cold request', row('305'))] });
  await shot(c, { slug: 'detail-escalate', title: 'Needs a repair job', say: 'A bigger repair, like an air conditioner that stays warm, can become a repair job that is tracked until it is finished.', targets: [C('Turn it into a repair job', insp('Escalate to work order'))] });
  await shot(c, { slug: 'detail-escalated', title: 'Now a repair job', say: 'The request now says it is tracked as a repair job. You can open it or undo the step.', targets: [L('Tracked as a repair job', { text: 'Tracked as a work order', within: '.insp' }), C('Open the repair job', insp('Open work order'))] });
});

add('F', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('F', 'Repair jobs', 'owner', 'Repairs that take more than a quick fix are tracked from report to final cost.');
  await shot(c, {
    slug: 'work-orders-list', title: 'All repair jobs', say: 'Repair jobs are grouped by stage, from Reported to Done, with the estimated or final cost on each.',
    targets: [L('Job that came from a request', { css: '.pill.accent', has: 'from ticket' }), L('High priority job', { css: '.pill.bad' }), C('Worn part, replace', insp('Worn part, replace'))],
  });
  await shot(c, { slug: 'work-order-assess-finding', title: 'Record what was found', say: 'After looking at the problem, tap what was found. You can also type your own note.', targets: [C('Outside contractor', insp('Outsource'))] });
  await shot(c, {
    slug: 'work-order-assess-contractor', title: 'In-house or outside help', scroll: { spec: insp('Estimated cost'), block: 'center' }, say: 'Choose whether your own team or an outside company does the work, and enter the company and the estimated cost.',
    targets: [T('Company name', insp('Contractor'), 'Benguet Pool Works'), T('Estimated cost', insp('Estimated cost'), '8500')],
  });
  await shot(c, { slug: 'work-order-assess-ready', title: 'Save the assessment', say: 'Save the assessment to move the job to the next stage.', scroll: { spec: insp('Save assessment'), block: 'center' }, targets: [C('Save assessment', insp('Save assessment'))] });
  await shot(c, { slug: 'work-order-assessed', title: 'Assessed, with an estimate', say: 'The job shows the estimate and who will do the work. Start the work when it begins.', targets: [L('Estimated cost', { css: '.insp .barline', nth: 0 }), C('Start work', insp('Start work'))] });
  await shot(c, { slug: 'work-order-in-progress', title: 'Work is under way', say: 'While the work goes on, you can put it on hold, for example while waiting for a part.', scroll: { spec: { css: '.insp .stepper' }, block: 'start' }, targets: [L('Progress bar', { css: '.insp .stepper' }), C('Put on hold', insp('Put on hold'))] });
  await shot(c, { slug: 'work-order-on-hold', title: 'The job is on hold', say: 'A job on hold stays visible until someone resumes it.', targets: [C('Resume work', insp('Resume work'))] });
  await shot(c, { slug: 'work-order-final-cost', title: 'Enter the final cost', say: 'When the work is finished, type what it really cost and complete the job. The request it came from is closed too.', scroll: { spec: insp('Complete'), block: 'center' }, targets: [T('Final cost', insp('Actual cost'), '9200'), C('Complete', insp('Complete'))] });
  await shot(c, { slug: 'work-order-done', title: 'Finished, estimate against cost', say: 'A finished job shows the estimate next to the final cost, in red when it cost more, with a history of every step.', targets: [L('Estimate and final cost', { css: '.insp .barline', nth: 1 }), L('History', { css: '.insp .timeline' }), side(env, 'Housekeeping')] });
});

add('G', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await main(env);
  chapter('G', 'Housekeeping', 'owner', 'Rooms to clean appear in the order they can be cleaned. Staff start and finish each room.');
  await shot(c, { slug: 'housekeeping-list', title: 'Rooms to clean', say: 'Rooms are grouped by what can happen next: ready to clean, in progress, guest still checking out, and so on.', targets: [L('Rooms ready now', { css: '.group-title', has: 'Ready to clean', words: true }), L('Rooms waiting for the guest', { css: '.group-title', has: 'Guest still checking out', words: true }), C('Start cleaning room 305', { btn: 'Start', within: HK('305') })] });
  await shot(c, { slug: 'housekeeping-started', title: 'A room is being cleaned', say: 'Room 305 moved to In progress. A room whose guest has left can be marked ready by hand.', targets: [L('Room being cleaned', { css: '.group-title', has: 'In progress', words: true }), C('Mark room 611 ready', { btn: 'Mark ready', within: HK('611') })] });
  await shot(c, { slug: 'housekeeping-ready', title: 'Another room is ready', say: 'Room 611 now waits in the Ready to clean group. When a room is finished, tap Done.', targets: [C('Finish room 305', { btn: 'Done', within: HK('305') })] });
  await shot(c, { slug: 'housekeeping-done', title: 'Finished rooms', say: 'Finished rooms move to the Done group at the bottom.', targets: [L('Finished room', { css: '.group-title', has: 'Done', words: true }), side(env, 'Handover')] });
});

add('H', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await main(env);
  chapter('H', 'Shift handover', 'owner', 'One screen for the next shift: what is open, late or promised to guests, and who signs it off.');
  await shot(c, {
    slug: 'handover-summary', title: 'Shift summary', say: 'The numbers show what is open, late, on hold and how many rooms still need cleaning. Promises to VIP guests are listed below.',
    targets: [L('The four numbers', { css: '.tiles' }), L('Promises made to guests', { css: '.group-title', has: 'Promises made to guests', words: true }), L('Items left by someone off shift', { css: '.group-title', has: 'Owner went off shift', words: true })],
  });
  await shot(c, { slug: 'handover-return', title: 'Return unassigned requests', say: 'Requests that belong to someone who went off shift can be sent back to their team with one tap.', scroll: { spec: { btn: 'Return' }, block: 'center' }, targets: [C('Return to the team queue', { btn: 'Return' })] });
  await shot(c, { slug: 'handover-ready', title: 'Sign the handover', say: 'When the next person has read the list, tap Acknowledge handover.', scroll: { spec: { btn: 'Acknowledge handover' }, block: 'end' }, targets: [C('Acknowledge handover', { btn: 'Acknowledge handover' })] });
  await shot(c, { slug: 'handover-signed', title: 'Handover signed', say: 'The screen shows who signed and at what time. The person going off shift is released.', scroll: { spec: { css: '.banner.ok' }, block: 'center' }, targets: [L('Who signed and when', { css: '.banner.ok' }), side(env, 'Insights')] });
});

add('I', async (env) => {
  const { shot, chapter, L } = env;
  const c = await main(env);
  chapter('I', 'Insights', 'owner', 'Live counts for the whole desk, by department. There are no rankings of people.');
  await shot(c, { slug: 'insights', title: 'Counts for this shift', say: 'Insights shows real numbers from the desk: requests logged, open, late, on hold, repair jobs and rooms ready.', targets: [L('The six numbers', { css: '.tiles' }), L('Scores by department', { css: '.group-title', has: 'By department', words: true })] });
  await shot(c, { slug: 'insights-held', title: 'Requests on hold longest', say: 'The longest waiting requests are listed so a department head can follow them up.', scroll: { spec: { css: '.group-title', has: 'Held longest' }, block: 'start' }, targets: [L('Held longest', { css: '.group-title', has: 'Held longest', words: true }), side(env, 'Settings')] });
});

/* ---------- PH. ON A PHONE ---------- */
add('PH', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const c = await env.newPage(env.browser, { vp: 'phone', url: deskUrl(env), role: 'owner', hotel: 'baguio' });
  chapter('PH', 'On a phone', 'owner', 'The same desk fits a phone, with tabs at the bottom and a big New request button.');
  const tab = (name) => C(`Open ${name}`, { btn: name, within: '.tabbar' });
  await shot(c, { slug: 'phone-requests-list', title: 'The desk on a phone', say: 'On a phone the tabs are at the bottom and a large button starts a new request.', targets: [L('Hotel name and logo', { css: '.topbar .brand' }), L('Connection shows Online', { css: '.topbar .conn' }), L('Bottom tabs', { css: '.tabbar' }), L('New request button', { css: '.fab' }), tab('More')] });
  await shot(c, { slug: 'phone-more', title: 'The More menu', say: 'Insights, Settings, the paper forms and sign out are under More.', targets: [L('More screens', { btn: 'Insights', within: '.sheet' }), C('Paper forms', sheet('Paper kit'))] });
  await shot(c, { slug: 'phone-paper-kit', title: 'Paper forms for emergencies', say: 'If power or battery fails, the desk shows the paper forms to use and how to enter them later.', targets: [L('Paper request log', { text: 'Request log', within: '.sheet' }), C('Close', sheet('Close'))] });
  await shot(c, { slug: 'phone-new-request', title: 'New request on a phone', say: 'The same room keypad, sized for a thumb.', prep: async (p) => { await env.sleep(700); await steps(p, [C('New request', { css: '.fab' })]); }, targets: digits('412', ROOM) });
  await shot(c, { slug: 'phone-new-request-needs', title: 'Choose what the guest needs', say: 'Scroll down to choose what the guest needs, then send the request.', scroll: NEEDS, targets: [C('Extra towels', sheet('Extra towels'))] });
  await shot(c, {
    slug: 'phone-ticket-detail', title: 'A request on a phone', say: 'Tap a request to see its steps. The big button does the next step.',
    prep: async (p) => { await steps(p, [C('Close', sheet('Close'))]); await env.sleep(500); await steps(p, [C('Room 305', row('305'))]); },
    targets: [L('Next step button', sheet('Done')), L('History', { css: '.sheet .timeline' })],
  });
  await shot(c, {
    slug: 'phone-safety-warning', title: 'Safety warning on a phone', say: 'A worrying word in the remark shows a red warning before the request is sent.',
    prep: async (p) => { await steps(p, [C('Close', sheet('Close'))]); await env.sleep(500); await steps(p, [C('New request', { css: '.fab' }), ...digits('810', ROOM), T('Remark box', sheet('Remark'), 'may usok sa hallway')]); },
    scroll: { spec: { css: '.sheet .banner.bad' }, block: 'center' }, targets: [L('Safety warning', { css: '.sheet .banner.bad' }), C('Raise safety alert', sheet('Raise safety alert'))],
  });
  await shot(c, { slug: 'phone-safety-alert', title: 'Safety alert on a phone', say: 'The alert fills the phone screen and says to call 911 or use the radio first.', targets: [L('What to do first', { css: '#sf-title', words: true }), C('I called 911 just now', { btn: 'I called 911 just now' }), C('Resolve with sign-off', { btn: 'Resolve with sign-off' })] });
  await shot(c, { slug: 'phone-work-orders', title: 'Repair jobs on a phone', say: 'Repair jobs have their own tab.', prep: async (p) => { await env.sleep(500); await steps(p, [tab('Work')]); }, targets: [L('A repair job', { css: '.ticket', nth: 0 }), tab('Housekeeping')] });
  await shot(c, { slug: 'phone-housekeeping', title: 'Housekeeping on a phone', say: 'Room attendants see which rooms are ready and tap Start.', targets: [L('Rooms ready to clean', { css: '.group-title', has: 'Ready to clean', words: true }), tab('Handover')] });
  await shot(c, { slug: 'phone-handover', title: 'Handover on a phone', say: 'The shift summary and the sign-off button work the same on a phone.', targets: [L('Shift numbers', { css: '.tiles' })] });
  await c.page.close();
  const b = await env.newPage(env.browser, { vp: 'phone', url: deskUrl(env, { hotel: 'boracay' }), role: 'owner', hotel: 'boracay' });
  await shot(b, { slug: 'phone-requests-list-boracay', title: 'The Boracay hotel on a phone', say: 'The Boracay hotel shows its own name, logo and teal colours.', targets: [L('Hotel name and logo', { css: '.topbar .brand' }), L('New request button', { css: '.fab' })] });
  await b.page.close();
});
