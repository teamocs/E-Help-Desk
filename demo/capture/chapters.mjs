// The scenes. Each chapter is [id, async (env) => ...]; shots are listed in the order a viewer meets them.
// A target is what the cursor touches AFTER the picture is taken (click / type) or points at (look), in order.
// Wording: plain words for title and say; selectors use the desk's own button texts.

export const ROOM = '[aria-label="Room number pad"]';
export const PIN = '[aria-label="PIN pad"]';
const BAGUIO = 'https://azaleabaguio.com/staging2-baguio/helpdesk';
const BORACAY = 'https://azaleaboracay.com/staging2/helpdesk';
const WRONG_PASSWORD = 'not-the-password';

export const deskUrl = (env, o = {}) => `${env.mock.base}/helpdesk/?role=${o.role ?? 'owner'}&hotel=${o.hotel ?? 'baguio'}${o.q ?? ''}`;
/** The shared owner desk (Baguio, desktop) that chapters B to O walk through. */
export async function main(env) {
  if (!env.desks.main) env.desks.main = await env.newPage(env.browser, { vp: 'desktop', url: deskUrl(env), role: 'owner', hotel: 'baguio' });
  return env.desks.main;
}
export const side = (env, name, label) => env.C(label ?? `Open ${name}`, { btn: name, within: '.side' });
export const newRequest = (env) => env.C('Start a new request', { btn: 'New request', within: '.side' });

export const chapters = [];
export const add = (id, fn) => chapters.push([id, fn]);

/* ---------- A. SIGN IN (the real staging sites, signed out; one fake sign-in) ---------- */
add('A', async (env) => {
  const { shot, chapter, C, L, T, state } = env;
  chapter('A', 'Signing in', 'everyone', 'Everyone reaches the help desk from the hotel website with their own email and password. A forgotten password has its own page.');
  const run = async (vp, hotel, base) => {
    const c = await env.newPage(env.browser, { vp, mock: false, hotel });
    const go = async (path) => {
      try { await env.open(c, base + path); return true; } catch (e) { state.skipped.push(`Sign-in page ${base + path} (${vp}): ${e.message}`); return false; }
    };
    return { c, go };
  };
  const brand = (h) => L('Hotel name', { text: `Azalea Hotels & Residences ${h}` });

  const d = await run('desktop', 'baguio', BAGUIO);
  if (await d.go('/login/')) {
    await shot(d.c, {
      slug: 'sign-in-baguio', title: 'Sign in page', say: 'Staff open the hotel help desk address and sign in with the email and password the hotel gave them.',
      targets: [brand('Baguio'), T('Email or username', { css: '#azl-login' }, 'staff@example.test'), T('Password', { css: '#azl-password' }, WRONG_PASSWORD), C('Sign in', { css: 'button[type=submit]' })],
    });
    await shot(d.c, {
      slug: 'sign-in-wrong-password', title: 'Wrong password message', say: 'If the email or password is not right, the page says so and the person can try again.',
      prep: () => env.sleep(1500),
      targets: [L('Message about the wrong password', { text: 'That email and password do not match' }), C('Forgot password?', { btn: 'Forgot password?' })], noact: true,
    });
  }
  if (await d.go('/forgot/')) {
    await shot(d.c, {
      slug: 'forgot-password', title: 'Forgot password page', say: 'Someone who forgot their password types their email and gets a link to choose a new one.',
      targets: [L('Email box', { css: '#azl-email' }), L('Send the link', { css: 'button[type=submit]' }), C('Back to sign in', { btn: 'Back to sign in' })], noact: true,
    });
  }
  if (await d.go('/reset/')) {
    await shot(d.c, {
      slug: 'link-expired', title: 'Link has expired page', say: 'A password link works once and stops working after a day. This page lets the person ask for a new one.',
      targets: [L('Expired link message', { text: 'This link has expired' }), C('Request a new link', { btn: 'Request a new link' })], noact: true,
    });
  }
  const b = await run('desktop', 'boracay', BORACAY);
  if (await b.go('/login/')) {
    await shot(b.c, {
      slug: 'sign-in-boracay', title: 'Boracay sign in page', say: 'The Boracay hotel has its own address and its own look, with the same simple form.',
      targets: [brand('Boracay'), L('Email box', { css: '#azl-login' }), C('Sign in', { css: 'button[type=submit]' })], noact: true,
    });
  }
  const pb = await run('phone', 'baguio', BAGUIO);
  if (await pb.go('/login/')) await shot(pb.c, { slug: 'sign-in-baguio', title: 'Sign in on a phone', say: 'On a phone the same page fits the screen, so staff can sign in anywhere in the hotel.', targets: [L('Email box', { css: '#azl-login' }), L('Password box', { css: '#azl-password' }), C('Sign in', { css: 'button[type=submit]' })], noact: true });
  const pc = await run('phone', 'boracay', BORACAY);
  if (await pc.go('/login/')) await shot(pc.c, { slug: 'sign-in-boracay', title: 'Boracay sign in on a phone', say: 'The Boracay hotel sign in page on a phone.', targets: [L('Email box', { css: '#azl-login' }), C('Sign in', { css: 'button[type=submit]' })], noact: true });
  if (await pb.go('/forgot/')) await shot(pb.c, { slug: 'forgot-password', title: 'Forgot password on a phone', say: 'Asking for a new password link from a phone.', targets: [L('Email box', { css: '#azl-email' }), L('Send the link', { css: 'button[type=submit]' })], noact: true });
  if (await pb.go('/reset/')) await shot(pb.c, { slug: 'link-expired', title: 'Expired link on a phone', say: 'An old password link shows this page and offers a new one.', targets: [C('Request a new link', { btn: 'Request a new link' })], noact: true });
});

/* ---------- B. THE DESK ---------- */
add('B', async (env) => {
  const { shot, chapter, C, L } = env;
  const c = await main(env);
  chapter('B', 'The desk', 'owner', 'The home screen: every guest request still open, what is late, and whether the desk is online.');
  await shot(c, {
    slug: 'requests-list', title: 'All open guest requests', say: 'This is the list of guest requests that are still open. Late ones and VIP guests are grouped at the top under Needs attention.',
    targets: [L('Hotel name and logo', { css: '.side .brand' }), L('Connection shows Online', { css: '.conn' }), L('Number of open requests', { css: '.side .badge' }), L('Needs attention group', { text: 'Needs attention' }), C('Overdue tab', { btn: 'Overdue', within: '.seg' })],
  });
  await shot(c, { slug: 'requests-overdue', title: 'Overdue requests only', say: 'The Overdue tab shows only the requests that took longer than their target time.', targets: [L('A late request', { css: '.ticket', nth: 0 }), C('On hold tab', { btn: 'On hold', within: '.seg' })] });
  await shot(c, { slug: 'requests-on-hold', title: 'Requests waiting on something', say: 'A request that has to wait, for example a guest who does not want to be disturbed, is parked here and its timer stops.', targets: [L('A request on hold', { css: '.ticket', nth: 0 }), C('Done tab', { btn: 'Done', within: '.seg' })] });
  await shot(c, { slug: 'requests-done', title: 'Finished this shift', say: 'The Done tab keeps a short list of everything finished during the shift.', targets: [L('A finished request', { css: '.ticket', nth: 0 }), C('Open tab', { btn: 'Open', within: '.seg' }), newRequest(env)] });
});

/* ---------- B2. THE OTHER HOTEL ---------- */
add('B2', async (env) => {
  const { shot, chapter, L } = env;
  const c = await env.newPage(env.browser, { vp: 'desktop', url: deskUrl(env, { hotel: 'boracay' }), role: 'owner', hotel: 'boracay' });
  chapter('B2', 'One desk, two hotels', 'owner', 'Each hotel gets its own name, logo and colours. The screens work the same way.');
  await shot(c, { slug: 'requests-list-boracay', title: 'The Boracay hotel desk', say: 'The Boracay hotel uses the same desk in its own teal colours and with its own name and logo.', targets: [L('Hotel name and logo', { css: '.side .brand' }), L('Teal colour of the hotel', { css: '.side-item[aria-current]' })] });
  await c.page.close();
});
