// Chapters C (new request) and E (safety) on the owner desk.
import { add, main, newRequest, ROOM } from './chapters.mjs';

export const sheet = (name, extra = {}) => ({ btn: name, within: '.sheet', ...extra });
export const NEEDS = { spec: { text: 'What they need', within: '.sheet' }, block: 'start' };

add('C', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const c = await main(env);
  chapter('C', 'Logging a new request', 'owner', 'A guest calls. The receptionist taps the room, chooses what the guest needs and sends it to the right team.');
  await shot(c, {
    slug: 'new-request-room', title: 'Tap the room number', say: 'Tap the room number on the keypad. Rooms you used a moment ago are shown as quick buttons.',
    targets: [L('Rooms used recently', { css: '#recent-rooms' }), ...digits('608', ROOM)],
  });
  await shot(c, {
    slug: 'new-request-needs', title: 'Choose what the guest needs', say: 'Tap what the guest asked for. A bundle such as Leak sends work to two teams at once.',
    scroll: NEEDS, targets: [L('A bundle for bigger problems', sheet('Leak bundle')), C('Extra towels', sheet('Extra towels'))],
  });
  await shot(c, {
    slug: 'new-request-remark', title: 'Add a short remark', say: 'If it helps, add a short note for the team. This step is optional.',
    scroll: { spec: { text: 'Remark (optional)', within: '.sheet' }, block: 'start' }, targets: [T('Remark box', sheet('Remark'), 'Two extra bath towels, please')],
  });
  await shot(c, {
    slug: 'new-request-ready', title: 'Send the request', say: 'Check the room and the request, then tap Log request. It goes straight to the right team.',
    scroll: { spec: sheet('Log request'), block: 'end' }, targets: [L('Optional room-only button', sheet('Log it later (room only)')), C('Log request', sheet('Log request'))],
  });
  await shot(c, {
    slug: 'requests-new-item', title: 'New request is in the list', say: 'The request appears at once in the list and the team is told. A short message confirms it was sent.', keepToast: true,
    targets: [L('The new request', { css: '.ticket', has: '608' }), L('Confirmation message', { css: '.toast' }), newRequest(env)],
  });
  await shot(c, {
    slug: 'new-request-room-only', title: 'Save just the room for later', say: 'When the guest is still talking, save only the room number with Log it later. Add what they need afterwards.',
    prep: (p) => steps(p, digits('905', ROOM)), scroll: { spec: sheet('Log it later (room only)'), block: 'end' },
    targets: [L('Log request waits for a choice', sheet('Log request')), C('Log it later (room only)', sheet('Log it later (room only)'))],
  });
  await shot(c, {
    slug: 'requests-finish-logging', title: 'Rooms waiting to be finished', say: 'A room saved without details waits in the Finish logging group until someone adds what the guest needs.', keepToast: true,
    targets: [L('Finish logging group', { text: 'Finish logging' }), C('The saved room', { css: '.ticket', has: '905' })],
  });
  await shot(c, {
    slug: 'detail-finish-logging', title: 'Add what the guest needs', say: 'Open the saved room, tap what the guest needs and add it to the ticket.',
    targets: [C('Room cleaning', { btn: 'Room cleaning', within: '.insp' }), C('Add to ticket', { btn: 'Add to ticket', within: '.insp' })],
  });
  await shot(c, { slug: 'requests-finished-logging', title: 'The room is now complete', say: 'Once the need is added, the request goes to the team like any other.', targets: [L('The completed request', { css: '.ticket', has: '905' }), newRequest(env)] });
  await shot(c, {
    slug: 'new-request-bundle', title: 'A bundle for bigger problems', say: 'Some problems need two teams. Choose the Leak bundle and both jobs are created.',
    prep: (p) => steps(p, digits('316', ROOM)), scroll: NEEDS, targets: [C('Leak bundle', sheet('Leak bundle'))],
  });
  await shot(c, {
    slug: 'new-request-bundle-chosen', title: 'The bundle explains itself', say: 'A line under the buttons says which teams will work and in which order.',
    scroll: { spec: { css: '.sheet p.t-foot', has: 'Engineering fixes' }, block: 'center' }, targets: [L('What the bundle does', { css: '.sheet p.t-foot', has: 'Engineering fixes' })],
  });
  await shot(c, {
    slug: 'requests-bundle', title: 'Two jobs from one request', prep: (p) => steps(p, [C('Log request', sheet('Log request'))]), say: 'The Leak request shows both teams. Engineering fixes the source first, then Housekeeping cleans up.', keepToast: true,
    targets: [C('The leak request', { css: '.ticket', has: '316' })],
  });
  await shot(c, {
    slug: 'detail-bundle', title: 'The second job waits its turn', say: 'The clean-up job waits and its timer does not run until the repair is finished.',
    targets: [L('Clean-up waits for the repair', { text: 'Waiting for' }), newRequest(env)],
  });
});

add('E', async (env) => {
  const { shot, chapter, C, L, T, digits, steps } = env;
  const c = await main(env);
  chapter('E', 'Safety alerts', 'owner', 'Words that point to danger raise a warning. The alert tells everyone what to do first and records who called 911.');
  await shot(c, {
    slug: 'safety-remark', title: 'A worrying word in a remark', say: 'If the remark mentions smoke, fire or another danger, even in Tagalog, the desk notices while the receptionist types.',
    prep: (p) => steps(p, digits('810', ROOM)), scroll: { spec: { text: 'Remark (optional)', within: '.sheet' }, block: 'start' },
    targets: [T('Remark box', sheet('Remark'), 'may usok sa hallway')],
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
    slug: 'requests-safety-banner', title: 'Alert banner on every screen', say: 'While the alert is open, a red banner stays at the top of the request list for everyone.',
    targets: [C('The red alert banner', { css: 'button.banner.bad' })],
  });
  await shot(c, {
    slug: 'safety-resolve', title: 'Closing the alert safely', say: 'When the danger is over, a manager or the owner signs the alert off. A false alarm can be lowered instead.',
    targets: [L('Lower to a false alarm', { btn: 'Downgrade to false alarm (logged)' }), C('Resolve with sign-off', { btn: 'Resolve with sign-off' })],
  });
  await shot(c, {
    slug: 'safety-second-alert', title: 'A second alert, lowered', say: 'Another report, this time a gas smell. Here it turns out to be a false alarm, so it is lowered and the note stays in the log.',
    prep: async (p) => { await env.sleep(600); await steps(p, [newRequest(env), ...digits('712', ROOM), T('Remark box', sheet('Remark'), 'amoy gas sa kwarto'), C('Raise safety alert', sheet('Raise safety alert'))]); },
    targets: [L('Safety words found', { css: '#sf-title', words: true }), C('Downgrade to false alarm', { btn: 'Downgrade to false alarm (logged)' })],
  });
});
