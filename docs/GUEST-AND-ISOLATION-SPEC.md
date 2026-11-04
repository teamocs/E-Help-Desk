# Staff phones, guest stay link, and isolated hosting (draft spec)

Status: DRAFT for review, written 2026-11-04. Only section 1 (Staff phones) is built; the rest is not built yet. Decisions marked **Decided** were confirmed by the owner on 2026-11-04; everything marked **Default** is my proposal and waits for the client.

## 1. Staff phones switch

**Decided, and built 2026-11-04 (plugin version unchanged, not yet deployed).** By default only the help desk (HDO, supervisor, manager, owner) runs and assigns work. Staff (housekeeping, engineering and so on) do not use the desk. A per hotel switch lets departments use a shared phone to see and act on their own queue.

- **Setting:** **Staff phones** in Configuration (section "Staff Phones"). Hotel switch default **off** (absent means off, so upgraded installs are off). Per department override: the Departments editor has "Staff may use shared phones"; only "off" is stored. Effective = hotel switch on and department not switched off. Owner and manager change it; a supervisor sees it. Saved with `PUT /staff-phones {on, baseRev}`, online only, like the lists: offline, the switch is disabled with a "No connection" note.
- **Off:** the server treats a staff-role PIN person as nobody (`Azl_Access::staff_kind()`). PIN sign-in is refused with "Staff phones are switched off at this hotel. Ask the help desk to log your work."; a token issued earlier is refused with the same words and writes nothing; the "Who's on shift?" screen does not offer them (the snapshot marks them `phone: false`; their names stay on records). A staff member who is signed in when it goes off is signed out on the next refresh and sees the reason on the PIN screen. The HDO logs the work for them.
- **On:** the department's shared phone, signed in by PIN, shows only that staff member's own queue and lets them mark On site and Done, as before. The PIN holder is recorded as the actor.
- Staff never assign, reassign or reorder work, whatever the setting.
- Help-desk officers, supervisors and managers (and owner and manager accounts) are never affected by the switch.
- **Not built:** the "by radio" attribution when the HDO logs for staff. Today the HDO can already relay, mark on site, hold and finish any department's items; the history records the HDO as the actor and the item stays assigned to the department's first on-shift person. Details, files and tests: docs/MODULES-SPEC.md D.1.
- **Mock:** the mock server has the switch on, so the demo keeps showing staff phones; the real default is off.

## 2. Guest stay link

**Decided.** The guest gets a link that stops working at checkout. Checkout must be logged. The guest can raise a request (a form) and send messages to the help desk.

### 2.1 Stay record
New table `azl_stays` (additive, `dbDelta`):
`id`, `room`, `guest_name` (optional), `checkin_at`, `checkout_at` (expected, hotel time Asia/Manila), `checked_out_at` (set when the desk logs the checkout), `token_hash`, `created_by`, `created_at`, `updated_at`.

- Check-in and check-out are logged in **House Status** (the sidebar stays at the client's 11 modules). Logging check-out closes the stay and can start a clean task in Cleaning.
- Editing the expected checkout (late checkout) moves the link's expiry.
- One open stay per room at a time.

### 2.2 The link
- URL `https://stay.<hotel domain>/s/<token>`. The token is 32 random bytes, shown once, stored only as a hash.
- The HDO shares it as a QR card, WhatsApp or SMS from the stay record.
- **Expiry rule:** valid from check-in until `checkout_at`, or until the desk logs the checkout, whichever is first. **Default:** no grace period, configurable per hotel. **Default checkout time** 12:00, set per hotel.
- Revoke and regenerate from the stay record (lost phone, shared by mistake).
- After expiry the page says "Your stay has ended" and shows the hotel's contact details. No data is shown.

### 2.3 What the guest sees and can do
- Their room and hotel name only. No other guests, no staff names, no internal notes.
- **Request form:** a short guest-facing list (towels, leak, air conditioning, maintenance, other). The list is a flag on the existing catalog items, so the hotel controls it. Creates a request in Requests with `source = guest` and `stay_id`.
- **Messages:** short text messages to the help desk. They appear in Inquiries as a guest thread; replies from staff appear on the guest page.
- **Status:** the guest sees "received, on the way, done" for their own requests. Guest status words are fixed plain text, never staff remarks.
- Always visible: "For fire or medical emergencies call [front desk / emergency number]." The guest page never relies on the safety word lane; guest text containing danger words is flagged to the HDO as urgent, but the page says to call.

### 2.4 Security
- A separate small bundle and a separate REST namespace `azl-ehd/v1/guest/*`, authenticated by the token only. It exposes two commands (create request, send message) and one read (this stay). It cannot reach the staff `command` or `snapshot` routes.
- Rate limits per token and per IP, message size cap, honeypot field, no file upload in v1.
- No guest personal data beyond room and the optional name. No payment, no ID data.
- **Default retention:** guest messages and stay records are purged 30 days after checkout; the requests they created follow the normal request retention.
- Responses are `no-store`; the page is `noindex`; a strict CSP.

## 3. Hosting and isolation

**Decided.** The client's cPanel is available and subdomains will be created from their real domain, all in the **same cPanel account**.

### 3.1 What same-account subdomains do and do not give
They give a separate web address, separate cookies and separate WordPress install. They do **not** give a separate server user: the public site and the help desk run as the same account, so a compromise of the public WordPress could read the help desk's files. The mitigations below reduce that risk; they do not remove it. A separate hosting account later would remove it, and nothing in the design prevents moving.

### 3.2 Layout (per hotel)
| Host | Purpose |
|---|---|
| `www.<domain>` | the public hotel website (unchanged) |
| `helpdesk.<domain>` | staff desk, login required, its own bare WordPress |
| `stay.<domain>` | guest pages only |

`helpdesk.` and `stay.` point at the **same** bare WordPress install, with a host check: `stay.` serves only `/s/<token>` and the guest namespace; `helpdesk.` serves only the staff desk and staff routes. Separate hostnames mean separate cookies, origins and CSP without a second install.

### 3.3 Hardening checklist for the bare install
- Own database and own database user, used by this install only. Nothing shared with the public site.
- Only the plugin installed. No theme output, no comments, XML-RPC off, user enumeration off, `noindex`.
- Host-only cookies. Make sure `COOKIE_DOMAIN` is not set to `.<domain>`, so the login cookie is never sent to `www.`.
- Per-domain PHP settings where cPanel allows it (MultiPHP INI Editor: `open_basedir`, disabled dangerous functions).
- File permissions 640 and 750, `wp-config.php` kept out of the web root where the host allows.
- AutoSSL for both subdomains. HSTS on both.
- Plugin "appliance mode" option: redirect `/` to the desk, hide wp-login from search, small admin menu.

### 3.4 Updates
Today each update needs ModSecurity switched off for the upload. On the dedicated install the plugin should pull updates from our own update channel (a small JSON feed plus a signed zip), so the zip is downloaded by the server and the browser upload that ModSecurity blocks is not needed.

### 3.5 Future
The desk talks to the server through one fixed command contract and the mock server already implements it, so the screens can move to a standalone backend later without a redesign.

## 4. Build order
1. Staff phones switch (small).
2. Dedicated staging install for Baguio on `helpdesk.` and `stay.` subdomains, appliance mode, update channel. Boracay follows once Baguio passes.
3. Stays: House Status check-in and check-out, the stay table, the guest namespace and guest page, guest thread in Inquiries.
4. Help guide, quick start and video updated once features settle.

## 5. Open questions for the client
1. Default checkout time per hotel, and whether any grace after checkout is wanted.
2. Is a guest-facing request list agreed (which items), and in which languages (English and Tagalog)?
3. Retention: purge guest messages 30 days after checkout, is that acceptable?
4. How will the link reach the guest (printed QR at check-in, WhatsApp, SMS), and who creates it?
5. Does the hotel use a PMS that could supply check-in and check-out later?
