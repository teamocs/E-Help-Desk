// Chapters F to M: Inquiries, Cleaning, Work Orders, House Status, Crisis Mgmt, Transport, Reminders (owner desk, in sidebar order).
import { add, main, side, scr, goTo } from './chapters.mjs';
import { sheet, insp } from './scenes-desk.mjs';

const form = (name) => ({ field: name, within: '.sheet' });
/** A date a few days from today in the hotel's own time (Asia/Manila), as the date boxes want it. */
const inDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/* ---------- F. INQUIRIES ---------- */
add('F', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('F', 'Inquiries', 'owner', 'Questions from guests and callers that are answered on the spot, such as opening hours or a booking. Each one is logged, noted and closed.');
  await shot(c, {
    slug: 'inquiries-list', title: 'All inquiries', say: 'Inquiries are quick questions from guests or callers. Each shows who asked, the room if there is one and how it is going.', prep: goTo(env, 'Inquiries'),
    targets: [L('Tabs for all, active and done', scr('Active')), L('Dates', { css: '#inq-from' }), L('The first inquiry', { css: '.inq-main', nth: 0 }), C('New Inquiry', scr('New Inquiry'))],
  });
  await shot(c, {
    slug: 'inquiry-form', title: 'Log a new inquiry', say: 'Choose who is asking, type the name and room, and write what they wanted to know. Then tap Submit.',
    targets: [C('Type of guest', { ...form('Type'), value: 'In-house' }), T('Name', form('Name'), 'Mr. Garcia'), T('Room', form('Room'), '506'), T('What was asked', form('Description'), 'Asked what time the pool closes and if towels are provided.'), C('Submit', sheet('Submit'))],
  });
  await shot(c, {
    slug: 'inquiry-logged', title: 'The inquiry is in the list', say: 'The new inquiry is at the top and counts in the number beside Inquiries in the sidebar. Note means someone has looked into it.', keepToast: true,
    targets: [L('The new inquiry', { css: '.inq-main', nth: 0 }), C('Note the inquiry', scr('Note I-0007'))],
  });
  await shot(c, { slug: 'inquiry-noted', title: 'Inquiry noted', say: 'A noted inquiry is still open. When the guest has their answer, tap Done.', targets: [L('Noted status', { css: '.inq-main', nth: 0 }), C('Done', scr('Done I-0007'))] });
  await shot(c, { slug: 'inquiry-done', title: 'Inquiry finished', say: 'A finished inquiry moves to the Done tab and shows how fast it was closed. Undo brings it back if it was closed by mistake.', prep: (p) => env.steps(p, [C('Done tab', scr('Done', { nth: 0 }))]), targets: [L('Closed in time', { css: '.inq-main', has: 'Mr. Garcia' }), C('Open the inquiry', { css: '.inq-main', has: 'Mr. Garcia' })] });
  await shot(c, { slug: 'inquiry-detail', title: 'History of an inquiry', say: 'The details list every step with the time and the person, from the first note to Done.', targets: [L('History', { css: '.insp .group-title', has: 'History', words: true }), C('Close details', insp('Close details')), side(env, 'Cleaning')] });
});

/* ---------- G. CLEANING ---------- */
add('G', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('G', 'Cleaning', 'owner', 'Every room to clean, who cleans it, and how long it took. Room attendants clock in and out, and rooms turn Ready when checkout is finished.');
  await shot(c, {
    slug: 'cleaning-list', title: 'Rooms to clean', say: 'Each room shows its type of clean, the room attendant, the status and the clock in and out times. A room turns Ready by itself when its checkout is finished.', prep: goTo(env, 'Cleaning'),
    targets: [L('Status filters', { css: '.chip', has: 'Ready' }), L('Rooms ready to clean', { css: 'tbody tr', nth: 3 }), C('Log Cleaning', scr('Log Cleaning'))],
  });
  await shot(c, {
    slug: 'cleaning-log-form', title: 'Log a clean', say: 'Type the room, choose the kind of clean and the room attendant. Clock In now starts the clock at once; untick it to log a clean that starts later.',
    targets: [T('Room', form('Room'), '412'), C('Kind of clean', { ...form('Type'), value: 'Checkout' }), C('Room attendant', { ...form('RA'), value: 'Joel Dizon' }), L('Clock In now is ticked', sheet('Clock In now')), C('Add', sheet('Add'))],
  });
  await shot(c, { slug: 'cleaning-logged', title: 'The clean is under way', say: 'Room 412 is now In Progress with the time it started. Clock Out ends it and shows how long it took.', keepToast: true, scroll: { spec: { css: 'tbody tr', has: '412' }, block: 'center' }, targets: [L('Room 412 in progress', { css: 'tbody tr', has: '412' }), C('Clock out room 412', scr('Clock out room 412'))] });
  await shot(c, { slug: 'cleaning-clocked-out', title: 'Clocked out with a duration', say: 'The finished room shows its clock out time and how many minutes the clean took.', scroll: { spec: { css: 'tbody tr', has: '412' }, block: 'center' }, targets: [L('Duration of the clean', { css: 'tbody tr', has: '412' }), C('Clock in room 305', scr('Clock in room 305'))] });
  await shot(c, { slug: 'cleaning-clocked-in', title: 'Another room starts', say: 'Clock In starts the clock for a room that was ready. The In Progress number goes up by one.', targets: [L('In Progress filter', { css: '.chip', has: 'In Progress' }), L('Room 305 in progress', { css: 'tbody tr', has: '305' })] });
  await shot(c, { slug: 'cleaning-mark-ready', title: 'Mark a room ready by hand', say: 'A queued room whose guest has left can be marked Ready by hand, so the room attendants can start.', scroll: { spec: { css: 'tbody tr', has: '611' }, block: 'center' }, targets: [L('A queued room', { css: 'tbody tr', has: '611' }), C('Mark room 611 ready', scr('Mark room 611 ready')), C('Ready filter', scr('Ready'))] });
  await shot(c, { slug: 'cleaning-ready-filter', title: 'Only rooms that are ready', say: 'The Ready filter lists the rooms waiting for a room attendant. Tap Edit to change the type of clean or who does it.', targets: [L('Rooms waiting', { css: 'tbody tr', nth: 0 }), C('Edit room 611', scr('Edit room 611'))] });
  await shot(c, { slug: 'cleaning-edit-form', title: 'Change a clean', say: 'Edit changes the room, the type of clean, the attendant, the role and the scheduled date.', targets: [L('Type of clean', form('Type')), L('Room attendant', form('RA')), C('Cancel', sheet('Cancel'))] });
  await shot(c, { slug: 'cleaning-schedule-form', title: 'Schedule rooms ahead', say: 'Schedule Rooms lists the rooms to clean on a later day, for example tomorrow’s checkouts.', prep: (p) => env.steps(p, [C('All filter', scr('All')), C('Schedule Rooms', scr('Schedule Rooms'))]), targets: [env.D('Checkout date', form('Checkout Date'), inDays(1)), T('First room', form('Room 1'), '501'), C('Add another room', sheet('Add room')), C('Schedule', sheet('Schedule'))] });
  await shot(c, { slug: 'cleaning-scheduled', title: 'Scheduled rooms', say: 'Scheduled rooms wait under the Scheduled filter until their day comes.', keepToast: true, targets: [C('Scheduled filter', scr('Scheduled')), side(env, 'Work Orders')] });
});

/* ---------- H. WORK ORDERS ---------- */
add('H', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('H', 'Work Orders', 'owner', 'Repairs that take more than a quick fix, tracked from report to final cost, with their priority and the day they are due.');
  await shot(c, {
    slug: 'work-orders-list', title: 'All work orders', say: 'Each work order shows its place, the problem, its priority and where it stands. Filters narrow the list by stage, priority or department.', prep: goTo(env, 'Work Orders'),
    targets: [L('Stage filters', { css: '.chip', has: 'Reported' }), L('Priority and department', { field: 'Priority', within: '.screen' }), L('First work order', { css: '.no', nth: 0 }), C('Report Work Order', scr('Report Work Order'))],
  });
  await shot(c, {
    slug: 'work-order-form', title: 'Report a work order', say: 'Say where it is, what is wrong and how urgent it is. Choose the department that should fix it and the day it should be done.',
    targets: [C('Area', { ...form('Area'), value: 'Room' }), T('Location', form('Location'), 'Room 508, bathroom'), T('Problem', form('Problem'), 'The sink drips all night and the tap does not close.'), C('Priority', { ...form('Priority'), value: 'High' }), C('Department to fix it', { ...form('Assign to Dept'), value: 'Engineering' })],
  });
  await shot(c, {
    slug: 'work-order-form-reporter', title: 'Who reported it', say: 'Add who reported the problem and the day it is needed. A tick on Preventive saves it as scheduled work to open later.',
    scroll: { spec: form('Requested completion'), block: 'center' }, targets: [C('Reporter department', { ...form('Reporter Dept'), value: 'Housekeeping' }), C('Reporter', { ...form('Reporter Name'), value: 'Joel Dizon' }), env.D('Day needed', form('Requested completion'), inDays(2)), L('Preventive work', sheet('Preventive')), C('Submit', sheet('Submit'))],
  });
  await shot(c, { slug: 'work-order-reported', title: 'The work order is reported', say: 'The new work order is at the top as Reported. Engineering sees it at once. The next step is to assess it.', keepToast: true, scroll: { spec: scr('Assess WO-'), block: 'nearest', inline: 'end' }, targets: [L('Deadline column', { css: 'th', has: 'Deadline', words: true }), C('Assess it', scr('Assess WO-'))] });
  await shot(c, { slug: 'work-order-assess-form', title: 'Assess the problem', say: 'Write what was found, or tap a quick answer. Then choose whether the hotel’s own team or an outside company does the work.', targets: [C('Worn part, replace', sheet('Worn part, replace')), C('Assignment', { ...form('Assignment'), value: 'Outsource' })] });
  await shot(c, { slug: 'work-order-assess-contractor', title: 'Outside company and cost', say: 'For an outside company, type its name. Add the estimated cost and, if you know them, the start and end dates. Then tap Submit.', targets: [T('Company', form('Contractor'), 'Benguet Plumbing Services'), T('Estimated cost', form('Est. cost'), '8500'), C('Submit', sheet('Submit'))] });
  await shot(c, { slug: 'work-order-assessed', title: 'Assessed, with an estimate', say: 'The work order is now Assessed with its estimate. When the work begins, tap Start.', scroll: { spec: scr('Start WO-'), block: 'nearest', inline: 'end' }, targets: [L('Deadline column', { css: 'th', has: 'Deadline', words: true }), C('Start the work', scr('Start WO-'))] });
  await shot(c, { slug: 'work-order-in-progress', title: 'Work is under way', say: 'While the work goes on, it can be put on hold, for example while waiting for a part, or completed.', scroll: { spec: scr('Hold WO-'), block: 'nearest', inline: 'end' }, targets: [L('Deadline column', { css: 'th', has: 'Deadline', words: true }), C('Hold the work order', scr('Hold WO-'))] });
  await shot(c, { slug: 'work-order-hold-form', title: 'Why is it on hold?', say: 'Write the reason, for example a part that has not arrived. The reason stays in the history.', targets: [T('Reason', form('Reason'), 'Waiting for the new tap from the supplier'), C('Hold', sheet('Hold', { nth: -1 }))] });
  await shot(c, { slug: 'work-order-on-hold', title: 'The work order is on hold', say: 'A work order on hold stays visible until someone resumes it.', keepToast: true, scroll: { spec: scr('Resume WO-'), block: 'nearest', inline: 'end' }, targets: [L('Deadline column', { css: 'th', has: 'Deadline', words: true }), C('Resume work', scr('Resume WO-'))] });
  await shot(c, { slug: 'work-order-drawer', title: 'Details and history', say: 'Tap a work order number to open its details: the assessment, the cost, every update and the audit trail.', prep: (p) => env.steps(p, [C('Open WO-0004', { css: '.no', has: 'WO-0004' })]), targets: [L('Assessment', { css: '.insp h3', has: 'Assessment', words: true }), L('Cost', { css: '.insp h3', has: 'Cost', words: true })] });
  await shot(c, { slug: 'work-order-drawer-updates', title: 'Updates and actions', say: 'Below the details are the updates and the audit trail, and the buttons to add an update, put the work on hold or complete it.', scroll: { spec: insp('Update'), block: 'end' }, targets: [L('Updates', { css: '.insp h3', has: 'Updates', words: true }), C('Update', insp('Update'))] });
  await shot(c, { slug: 'work-order-update-form', title: 'Add a progress update', say: 'An update is a short note, for example that the plumber arrived. Tick Extend deadline if the work will take longer.', targets: [T('Progress update', form('Progress update'), 'Plumber arrived and is replacing the washer'), L('Extend the deadline', sheet('Extend deadline')), C('Save', sheet('Save'))] });
  await shot(c, { slug: 'work-order-complete-form', title: 'Complete with the final cost', say: 'When the work is finished, write what was done and the real cost, then tap Complete.', prep: (p) => env.steps(p, [C('Complete', insp('Complete WO-0004'))]), targets: [T('What was done', form('Completion notes'), 'Replaced the washer, sink no longer drips'), T('Final cost', form('Actual cost'), '9200'), C('Complete', sheet('Complete', { nth: -1 }))] });
  await shot(c, { slug: 'work-order-done', title: 'Finished, estimate against cost', say: 'A finished work order shows the estimate next to the final cost and a full history. Reopen is there if the problem comes back.', keepToast: true, targets: [L('Done stage', { css: '.chip', has: 'Done' }), C('Done filter', scr('Done')), side(env, 'House Status')] });
});

/* ---------- I. HOUSE STATUS ---------- */
add('I', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('I', 'House Status', 'owner', 'A logbook of what is going on in the house that is not a guest request, such as a slow drain or a noisy renovation, with notes until it is closed.');
  await shot(c, {
    slug: 'house-status-list', title: 'Logs of the house', say: 'Each log tells what happened, who wrote it and its status. The number beside House Status counts the logs that are not closed.', prep: goTo(env, 'House Status'),
    targets: [L('Filters', { css: '.chip', has: 'Not closed' }), L('The latest log', { css: '.t-head', nth: 0, words: true }), C('New Log', scr('New Log'))],
  });
  await shot(c, { slug: 'house-status-form', title: 'Write a new log', say: 'Describe what happened in plain words and choose Monitoring or Pending. Then tap Log.', targets: [T('What happened', form('Incident Narration'), 'Guest in 305 reported a slow drain in the bathroom. Plumber informed.'), C('Status', { ...form('Status'), value: 'Pending' }), C('Log', sheet('Log')) ] });
  await shot(c, { slug: 'house-status-logged', title: 'The log is in the list', say: 'The new log is at the top. Add an update each time something changes.', keepToast: true, targets: [L('The new log', { css: '.t-head', nth: 0, words: true }), C('Add an update', scr('Add an update to HS-0004'))] });
  await shot(c, { slug: 'house-status-update-form', title: 'Add an update', say: 'An update is a short note with the time. It is added under the log and nothing is overwritten.', targets: [T('Update', form('Update'), 'Plumber cleared the drain and will check again tomorrow'), C('Add update', sheet('Add update'))] });
  await shot(c, { slug: 'house-status-updated', title: 'The log has an update', say: 'The update shows under the log with who wrote it. When the problem is gone, close the log.', keepToast: true, targets: [L('The update', { css: '.t-head', nth: 0, words: true }), C('Close the log', scr('Close HS-0004'))] });
  await shot(c, { slug: 'house-status-close-form', title: 'Close the log', say: 'A closing note says how it ended. A closed log can be opened again later.', targets: [T('Closing note', form('Closing note'), 'Drain fixed and checked, room back in service'), C('Close', sheet('Close', { nth: -1 }))] });
  await shot(c, { slug: 'house-status-closed', title: 'Closed logs', say: 'Closed logs move out of the Not closed count. Reopen is there if the problem returns.', keepToast: true, targets: [C('Closed filter', scr('Closed')), side(env, 'Crisis Mgmt')] });
});

/* ---------- K. CRISIS MGMT ---------- */
add('K', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('K', 'Crisis Mgmt', 'owner', 'The safety alert comes first: call 911 or use the radio. The case log keeps the record of a crisis, with its code, place, people and every update.');
  await shot(c, {
    slug: 'crisis-home', title: 'Safety alerts and crisis cases', say: 'The red notice comes first: call 911 or use the radio, then log. The safety alerts raised from a request are listed here, and below them are the crisis cases.', prep: goTo(env, 'Crisis Mgmt'),
    targets: [L('Call 911 or radio first', { text: 'CALL 911 / RADIO FIRST', words: true }), L('Safety alerts', { css: '#alerts-title', words: true }), L('Crisis cases', { css: '#cases-title', words: true }), C('Log a case', scr('Log a case'))],
  });
  await shot(c, { slug: 'crisis-case-form', title: 'Log a crisis case', say: 'Choose the radio code, then add where it happened and what happened. Only the code is needed to save a case, so it can be done fast.', targets: [C('Radio code', { ...form('Radio code'), value: '10-9' }), T('Reported by', form('Reported by'), 'FO Staff 2'), C('Where', { ...form('Where'), value: 'Lobby' })] });
  await shot(c, { slug: 'crisis-case-form-ready', title: 'Say what happened and save', say: 'Write what happened in a sentence, then tap Log case. The record is kept with the time and your name.', scroll: { spec: sheet('Log case'), block: 'end' }, targets: [T('What happened', form('What happened'), 'Guest felt dizzy in the lobby. Nurse called.'), C('Log case', sheet('Log case'))] });
  await shot(c, { slug: 'crisis-case-logged', title: 'The case is logged', say: 'The new case is at the top as Active. The number beside Crisis Mgmt counts the cases that are not resolved.', keepToast: true, targets: [L('The new case', { css: '.cr-card', nth: 0 }), C('Open the case', { css: '.cr-card', nth: 0 })] });
  await shot(c, { slug: 'crisis-case-detail', title: 'The case and its updates', say: 'The case shows its code, who reported it and every update. From here record the 911 call, add an update, or link a safety alert.', targets: [L('The 911 button', sheet('I called 911 just now')), L('Link a safety alert', form('Link a safety alert')), C('Add an update', sheet('Update'))] });
  await shot(c, { slug: 'crisis-update-form', title: 'Add an update', say: 'Write what changed, for example that the ambulance arrived. The time and the name are saved with it.', targets: [T('Update', form('Update'), 'Nurse checked the guest, ambulance on the way'), C('Add update', sheet('Add update', { nth: -1 }))] });
  await shot(c, { slug: 'crisis-monitor-form', title: 'Keep watching a case', say: 'Monitor means the danger is over but someone is still watching. Write who is watching and how often.', prep: (p) => env.steps(p, [C('Monitor', sheet('Monitor'))]), targets: [T('Monitoring note', form('Monitoring note'), 'Guest resting, nurse checks every 30 minutes'), C('Monitor', sheet('Monitor', { nth: -1 }))] });
  await shot(c, { slug: 'crisis-monitoring', title: 'A case being monitored', say: 'The case now shows as Monitoring and the filters show how many cases are open, monitoring or closed.', keepToast: true, targets: [L('Case filters', { css: '.chip', has: 'Monitoring' }), C('Monitoring filter', scr('Monitoring')), side(env, 'Transport')] });
});

/* ---------- L. TRANSPORT ---------- */
add('L', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('L', 'Transport', 'owner', 'The hotel vans and cars: log a trip as it leaves, mark it arrived, or schedule trips for later.');
  await shot(c, {
    slug: 'transport-list', title: 'The transport log', say: 'Each trip shows the vehicle, the driver, where it went and its status. Scheduled trips are waiting, En Route are out, Arrived are back.', prep: goTo(env, 'Transport'),
    targets: [L('Filters', { css: '.chip', has: 'En Route' }), L('The latest trip', { css: '.tr-no', nth: 0 }), C('Log Trip', scr('Log Trip'))],
  });
  await shot(c, { slug: 'transport-trip-form', title: 'Log a trip', say: 'Pick the vehicle, then type the driver, the destination, the purpose and who is travelling. Depart starts the trip now.', targets: [C('Vehicle', { ...form('Vehicle'), value: 'Van 1' }), T('Driver', form('Driver'), 'Mang Ben'), T('Destination', form('Destination'), 'Loakan Airport'), T('Purpose', form('Purpose'), 'Guest transfer'), T('Passengers', form('Passengers'), 'Mr. and Mrs. Tan'), C('Depart', sheet('Depart'))] });
  await shot(c, { slug: 'transport-departed', title: 'The trip is en route', say: 'The trip is listed as En Route with the time it left. The Dashboard shows how many trips are out.', keepToast: true, targets: [L('The new trip', { css: '.tr-no', nth: 0 }), C('Mark it arrived', scr('Mark arrived TR-0006'))] });
  await shot(c, { slug: 'transport-arrived', title: 'The trip has arrived', say: 'Arrived records the time the vehicle got there. The vehicle is free for the next trip.', keepToast: true, targets: [L('Arrived trip', { css: '.tr-no', nth: 0 }), C('Open the trip', { css: '.tr-no', nth: 0 })] });
  await shot(c, { slug: 'transport-trip-detail', title: 'A trip in detail', say: 'The details show the whole trip. Edit changes a wrong name or place.', targets: [L('Edit the trip', sheet('Edit')), C('Close', sheet('Close', { nth: 0 }))] });
  await shot(c, { slug: 'transport-schedule-form', title: 'Schedule a trip', say: 'For a trip later, choose the date and the time as well. It waits as Scheduled until the vehicle leaves.', prep: (p) => env.steps(p, [C('Schedule Trip', scr('Schedule Trip'))]), targets: [C('Vehicle', { ...form('Vehicle'), value: 'Van 2' }), T('Destination', form('Destination'), 'Burnham Park'), env.D('Date', form('Date'), inDays(1)), env.D('Time', form('Time'), '09:30'), C('Schedule', sheet('Schedule'))] });
  await shot(c, { slug: 'transport-scheduled', title: 'Scheduled trips', say: 'The scheduled trip waits under the Scheduled filter. Tap Depart on the day it leaves.', keepToast: true, targets: [C('Scheduled filter', scr('Scheduled')), side(env, 'Reminders')] });
});

/* ---------- M. REMINDERS ---------- */
add('M', async (env) => {
  const { shot, chapter, C, L, T } = env;
  const c = await main(env);
  chapter('M', 'Reminders', 'owner', 'Things the desk must not forget: a call to make, a VIP to prepare for, a follow up. Each reminder can be given to a person and tied to a request.');
  await shot(c, {
    slug: 'reminders-list', title: 'All reminders', say: 'Each reminder shows what to do, who it is for and when. Overdue reminders are shown in red. The number beside Reminders counts the pending ones.', prep: goTo(env, 'Reminders'),
    targets: [L('Tabs for all, pending and done', scr('Pending')), L('The first reminder', { css: '.screen li, .screen tr', nth: 0 }), C('New Reminder', scr('New Reminder'))],
  });
  await shot(c, { slug: 'reminder-form', title: 'Add a reminder', say: 'Write what to remember, choose who it is for and when it is due. A reminder can also be linked to a request.', targets: [T('What to do', form('Description'), 'Call the laundry about the missing linen'), C('Who it is for', { ...form('Assigned'), value: 'Maria Santos' }), env.D('When', form('Scheduled'), `${inDays(1)}T09:00`, 'Tomorrow, 9:00 AM'), C('Linked request', { ...form('Link to'), value: 'T-0101' }), T('Notes', form('Notes'), 'Room 412 is a VIP guest'), C('Create', sheet('Create'))] });
  await shot(c, { slug: 'reminder-created', title: 'The reminder is saved', say: 'The new reminder is in the list. When it is done, tap Done.', keepToast: true, targets: [L('The new reminder', { css: '.screen li, .screen tr', has: 'laundry' }), C('Done', { btn: 'Done: Call the laundry', within: '.screen' })] });
  await shot(c, { slug: 'reminder-done', title: 'Reminder finished', say: 'A finished reminder moves to the Completed tab with the time it was done.', targets: [C('Completed tab', scr('Completed')), L('Pending count in the sidebar', { css: '.side-item', has: 'Reminders' })] });
  await shot(c, { slug: 'reminders-completed', title: 'Completed reminders', say: 'The Completed tab is the record of everything that was done.', targets: [L('Completed reminders', { css: '.screen li, .screen tr', nth: 0 }), side(env, 'Reports')] });
});
