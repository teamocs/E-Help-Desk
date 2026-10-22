# Azalea e-Helpdesk: Technical Trial and First Release (Plain Version)

**Status:** Draft for review. Based on the build brief and my audit of it. I did not review the v8 prototype.
**Estimates** are rough, not quotes. Design, testing and project management time are not included.

---

## Part 1. The 3-week technical trial

### What it is
A short experiment before we commit to building. We test the riskiest ideas on a small scale and end with a clear decision.

### What we need to find out
1. **How should phones share data?** We pick a "sync" method so phones keep working offline and catch up later without losing or duplicating tickets.
2. **Can a small computer at the hotel run the system?** It must survive power cuts without corrupting data.
3. **Can an Android app deliver alerts all shift?** A website can't do this on a locked phone.
4. **How do phones trust the hotel computer?** Secure connections are required for the camera and offline features.
5. **What if a phone's clock is wrong?** Timers and "who tapped first" must still come out right.
6. **What happens when we update the app?** A phone that was offline for days must not break.

### The three ways to do sync (we test them side by side)
| Option | In plain words |
|---|---|
| A | Use a ready-made sync service that mirrors the database onto each phone (for example PowerSync). |
| B | Use a different ready-made service with a lighter approach (for example ElectricSQL). |
| C | Build our own simple version as a baseline. |

I have not verified the cost, licence or hosting rules for A and B. Week 1 checks that before any real work.

### What we test, and what counts as a pass
| # | What we do | Passes if |
|---|---|---|
| 1 | Unplug the internet with 5 devices running | Nothing is lost. Updates reach other devices in under 2 seconds. |
| 2 | One phone loses WiFi for 10 minutes and logs 20 tickets | All 20 appear within 30 seconds of reconnecting. No duplicates, no false alarms. |
| 3 | Two people claim the same job, one of them offline | One clear winner. The other is told. Nothing escalates by mistake. |
| 4 | Taps arrive in the wrong order | The ticket ends up consistent and the real order is kept. |
| 5 | Set a phone's clock 10 minutes wrong | Timers and ordering are still correct. |
| 6 | Phone offline for 3 days, then the app is updated | Old actions are converted or rejected clearly. Nothing is silently lost. |
| 7 | Replay 1,000 queued actions | No duplicates. |
| 8 | Cut power to the hotel computer mid-save, 20 times | No half-saved tickets. The last confirmed ticket is there. |
| 9 | Restore from last night's backup onto a new computer | Phones reconnect cleanly. We record how long it takes. |
| 10 | Attach a photo while offline | The ticket saves first. The photo uploads later. |
| 11 | Android app, screen off, 8 hours, budget phone | Alerts arrive within 5 seconds every time. We record battery use. |
| 12 | iPhone in the background | We document what it can't do (expected: no reliable alerts). |
| 13 | Secure connection on the hotel network, two methods | We pick one and write down the steps. |
| 14 | Safety word typed with the network off | A warning sounds on that phone. |

### How we choose
We pick the option that passes tests 1 to 9 with the least custom code. If none pass tests 2 and 3 reliably, we build our own (option C) and raise the Phase 1a estimate.

### Timeline
| Week | Work |
|---|---|
| 1 | Check costs and licences. Set up the hotel computer and test devices. Test the secure connection. |
| 2 | Build a small test version on each option. Run tests 1 to 7. Start the Android app. |
| 3 | Run tests 8 to 14. Score the options. Write the decision note. |

### What we hand over
1. A one-page decision: which approach, why, and what we rejected.
2. The test results.
3. A working example of the hotel-computer setup.
4. A revised estimate for the first release.

### What could change the plan
- Android alerts fail on budget phones: we must specify approved phone models and battery settings.
- Secure connections are painful: add the steps to the hotel setup checklist.
- Updates lose data: the first release needs a mandatory version check.

---

## Part 2. First release (Phase 1a)

### Goal
Prove the everyday loop: log a request fast, send it to the right team, finish it, hand over at shift change, and keep working through outages. We run it in **shadow mode**, with timers and dashboards hidden from managers until the data can be trusted.

### What is in
| Area | What staff get | Size |
|---|---|---|
| Foundations | Hotel and device setup, quick personal PIN login, roles, a record of who did what | Large |
| Offline and sync | Phones keep working offline and catch up later. Screens show "waiting to send (N)" or "sent" | Large |
| Requests | Log a room and item in under 5 seconds. Relay, on site, hold, done, can't do, transfer, hand off. A few one-tap bundles like "Leak". Log now, finish later | Large |
| Work orders | The v8 maintenance flow with contractors, estimated vs actual cost, and escalating a request to a work order with undo | Medium |
| Cleaning | Cleaning types and states. A "checkout" or "inspection" item marks the room ready | Small |
| Shift handover | One-tap summary for the incoming officer. Open items return to the department queue | Medium |
| Alerts | Quiet by default. Sound only for urgent items. Alerts go to the person responding. A safety-word warning on the phone | Medium |
| Response times | Timers per item type, paused while on hold, reported by department only. Hidden from management at first | Medium |
| Basic reports | Download the ticket log as a spreadsheet. Work order cost summary. A short list of problems | Medium |
| Minor modules | Reminders, simple inquiries, crisis logbook with "CALL 911 / RADIO FIRST, THEN LOG" at the top | Small |
| Operations | Hotel computer setup, nightly backups with a tested restore, safe shutdown on battery backup, remote health checks | Medium |
| Pilot readiness | WiFi dead-zone survey, phone setup and charging routine, staff data-use charter, paper forms for outages, training and a drill | Small |

Size guide: Small is 1 to 2 person-weeks, Medium 2 to 3, Large 4 to 6.
The total is about 38 person-weeks. That is roughly **4 to 6 months for 2 to 3 developers**. The trial will refine this.

### What waits for later
| Item | Why it waits |
|---|---|
| Photos and video | Adds storage and privacy work. Planned for release 1b. |
| Voice-to-text | Heavy on budget phones. Scope still undecided. |
| Phone-call paging of managers | Needs a decision on the hotel phone system and legal review. |
| Transport and house status | Not needed for the core loop. |
| Pre-arrival checks, billing disputes, lost and found | Depend on booking-system data and legal review. |
| Guest confirmation of fixes, compensation tools | Need guest messaging and finance rules (Phase 2). |
| Guest marketing and omnichannel messages | Optional and privacy-sensitive (Phase 3). |
| Booking-system link | System not yet confirmed. A simple import is possible earlier. |
| Advanced reports and monthly archives | Need trusted data first (Phase 2). |

### How we'll know it works
| Check | In plain words |
|---|---|
| A1 | A full shift runs on it at the pilot property. |
| A2 | Unplug the internet and the team still sees each other's tickets. |
| A3 | A phone loses WiFi, saves its taps, and catches up with no false alarms. |
| A4 | Power cut: the system runs on battery backup, then paper, and the paper entries can be re-entered. |
| A5 | A safety word sounds a warning, and the alert reaches other Android phones offline. |
| A6 | Every v8 action works as in the prototype, including undoing an escalation and the automatic "room ready" rule. |
| A7 | A common request is logged faster than a radio call. |

---

## Open questions

### Azalea and Bryden
1. Which property is the pilot: Boracay, Baguio, or either?
2. Which booking system does each property use?
3. Who buys and looks after the hotel computer, battery backup and WiFi upgrades?
4. Are staff phones issued or personal, Android or iPhone, and who pays for charging and data?
5. Will front-desk and night staff do short interviews about real near-misses?
6. Who is Azalea's data protection officer, and will they do a privacy review first?

### OCS
7. Will OCS own on-site hardware and 24/7 support, or start cloud-only?
8. How is it priced, and what liability cap and insurance apply?
9. Is the team one developer or two to three? (Solo: about 9 to 12 months.)
10. How should the safety alert call a manager: hotel phone system or a calling service?
11. Is voice-to-text in the first release?

### Outside expert, or a fix to the brief
12. Lawyer review of the safety wording, the "not a life-safety system" contract language, and the legal citations in the brief.
13. Guest confirmation (Phase 2) needs guest messaging (Phase 3). Which moves?
14. "No links in messages" contradicts "invite guests to a web form". Which wins?
15. Is the crisis module only a logbook for the pilot?

### Main risks to watch
- Sync is harder than expected (the trial exists to find out early).
- Budget Android phones stop the alert service to save battery.
- Weak WiFi at the property.
- Staff stop using the tool if it feels like surveillance (shadow mode, the data-use charter and department-only reporting address this).
- The first release grows back into the full brief.
