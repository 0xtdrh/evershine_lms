# Teaching modes (a02) — design

Status: DESIGN, agreed with the owner in chat 2026-10-26/27 (not built yet). Owner: "maybe the most important part of the
system". Build in four phases (M1–M4); each phase needs the owner's «ابدأ». Arabic summary for the owner: artifact page
"Teaching modes" (linked from the roadmap item a02).

## 0. The idea in one line

Three ways to attend a session — **BRANCH** (in a room), **ONLINE** (live meeting), **RECORDED** (video, any time) — and
three building blocks that combine them:

| Block | Covers |
|---|---|
| A. A group whose every session has a mode | branch only, online only, hybrid (Sat branch / Tue online), blended (3 recorded + 1 branch), one student online for one session |
| B. Bookable sessions | One-to-One (a group of one, fixed weekly time) and office hours for recorded-course students |
| C. Self-paced enrolment | recorded courses (subscription or one-time purchase), progress, certificate, free live sessions |

Everything plugs into what exists (one system): attendance, instructor pay + pay statement, invoices / wallet / discounts,
place prices, partners, curriculum + lessons, calendar, substitutes, holidays, makeups, renewals, excuses, group rules,
notifications (AR + EN, WhatsApp), today's tasks, settings / reports centres, month close, permissions (4 levels), places,
import / export, user guide.

## 1. Owner decisions (2026-10-26/27)

Catalog and modes
- Allowed modes can be fixed at track / course / level / curriculum session (branch only, online only, recorded only, or a
  mix); the most specific wins; the system refuses a group / session that breaks it.
- Ready **templates** of session mixes (e.g. "1 online + 1 branch", "3 recorded + 1 branch") chosen in course settings;
  the course has a default template, a level may change it; a group copies it and may change its own slots.
- **Standalone courses** with no track (summer workshop, short course) — `AcademicSubject.trackId` is already optional.
- What is offered can differ by place: a whole track / course / level / curriculum may exist only for one partner or
  branch (partner A's robotics track ≠ partner B's).
- Curricula may differ per mode and per partner.
- "Online" becomes its own place (Campus kind ONLINE) — own prices, managers, reports, month close. A student who came from
  a partner stays attributed to that partner.

Attendance
- Live online: minutes in the meeting; ≥ 70 % (setting) = PRESENT, less = PARTIAL; camera off = "present, camera off".
  PARTIAL counts as a session for the student and for instructor pay; families see the state.
- Recorded session inside a group = attended when 80 % (setting) of the video was watched.
- Camera is required in live online courses (consent + rule in the group rules / agreements).
- Technical-problem excuse type (existing excuses system).

Instructors, rooms
- Working hours per weekday: either a fixed SHIFT or AVAILABLE hours ("after 17:00"), per place or online; extra free
  times outside the shift.
- Substitute picker / 1:1 booking show only qualified AND free instructors.
- Two different branches on the same day: **blocked**; only a Super Admin can force it (logged).
- Rooms for branches AND partner places: none / fixed rooms (name, capacity, type) / a varying number per weekday. No double
  booking, group size ≤ room capacity. Room usage report.
- Pay per session can differ by mode (online vs branch; missing online rate = branch rate).

Online meetings
- Google Meet AND Zoom (company setting, per-group override); other options to be compared (Teams, BigBlueButton, Jitsi,
  per-minute embedded rooms like Daily / 100ms) — an embedded room gives control of camera / device / identity.
- Auto meeting link, minutes per student, recording fetched.
- Link only through "Join" in the student's account, opens 10 min before.
- Instructor late: 5 min → app + WhatsApp to the instructor + alert to the manager; 15 min → families told; 30 min →
  cancelled as TechNova-side, apology message, makeup created.
- Live recordings: hidden until the quality team reviews (sampling, e.g. 20 %); optional auto-open after N hours; a company
  switch "live recordings are never shown to students"; retention N days (setting, e.g. 40).
- Recording consent required for online courses.

One-to-One
- A group of ONE student (reuses attendance, invoices, wallet, lessons, reports, renewals, makeups, pay, refunds).
- Online or in a branch. ONE fixed weekly time chosen by the parent.
- Parent picks a time → the system offers it to a qualified free instructor who accepts (declines → next one); or setting
  "assign without asking". Secretary can book too.
- Price per level (own price list). 4 sessions a month, renews like groups.
- Cancel ≥ 24 h before (setting); 2 postponements a month; unused sessions carry over 1 month — the parent must read and
  accept these rules (group-rules acceptance proof).
- Online 1:1 sessions are always recorded (child safety); a supervisor may join.
- 3 no-shows without notice → the fixed time is released; next session cannot be booked while unpaid.

Recorded courses
- Subscription (locks when it ends, progress kept) or one-time purchase (never locks).
- Open all / in order (existing lesson gates); watch tracking: seconds per video (played, ≤ 2x), when the platform / video
  was opened; checkpoint questions; "stopped watching N days" → follow-up list.
- No download / no sharing: protected video (DRM provider), student name + phone watermark. Screen recording cannot be
  blocked 100 % — stated honestly.
- Student account = ONE device: a new login signs the other out, family told. Parent accounts unlimited (father + mother
  each have their own).
- Office hours: instructor opens a slot with min / max seats (setting per slot); below min N h before → cancelled, seats
  returned. ONE free live session per cycle; more are paid.
- Open to outside students (not TechNova, not Hurghada): public catalog page, self sign-up, Paymob, times in their zone.

Codes, partners
- **Enrolment codes**: one code or a batch for any course / group / 1:1 package / recorded course; FREE, DISCOUNT or
  PREPAID; max uses, expiry, owner (company / branch / partner); the student types it in the dashboard → enrolled at once;
  usage log; print as cards / Excel; brute-force protection (rate limit).
- Partner share per online / recorded student: very flexible — none, percent, partner PAYS for the student, per student
  or per group, different by mode (online / branch / recorded / mix). Extends `PartnerDeal`.

Enrolment
- Staff (by permission) enrol a student in ANY mode from the student page ("Enrol in…"); parents from the portal /
  public page; students with a code.

Still open: trial session (owner thinking), placement test (thinking), meeting tool + video provider (comparison of
prices to be made), Google accounts for kids (Meet needs them; Zoom / embedded do not).

## 2. Phases

### M1 — foundation (no external services)
Data (all additive / nullable):
- `allowedModes Json?` on Track, AcademicSubject, Level, CurriculumSession; pure resolver `lib/delivery/modes.ts`.
- `OfferedIn` (entityType TRACK|COURSE|LEVEL, entityId, campusId) — no rows = offered everywhere.
- `CurriculumVariant` (levelId, name, modes[], campusIds[]) and `CurriculumEdition.variantId?` — group picks the variant
  (group > partner place > mode > default); the pin rule stays.
- `DeliveryTemplate` (name, pattern Json: ordered list of modes per weekly slot), `AcademicSubject.deliveryTemplateId?`,
  `Level.deliveryTemplateId?`, `ClassSection.deliveryTemplateId?`.
- `scheduleSlots` items get `mode` (default BRANCH) and `roomId?`; `SessionModeOverride` (group, date, mode, roomId) and
  `StudentSessionMode` (enrollment, date, mode) for one-off changes.
- Campus kind `ONLINE` (one row, made by setup), `Campus.roomMode` NONE|FIXED|DAILY, `Room` gets `kind` (reuse the legacy
  table, add nullable column), `RoomDayCount` (campus, weekday, count).
- `TeacherWorkHours` (teacher, weekday, from, to, kind SHIFT|AVAILABLE, campusId? / online flag) + availability engine
  `lib/teachers/availability.ts` (hours − groups − 1:1 − covers − office hours); same-day two-branch block with Super Admin
  force (logged).
- Attendance: enum `AttendanceStatus` gains PARTIAL, CAMERA_OFF, WATCHED (adding values is non-destructive) + nullable
  `minutes`, `mode` on the record.
- Pay: online per-session rate on `Teacher` / `SubjectOffering` / `TeacherPlacePay` (nullable); pay statement by mode.
- Screens: course settings (modes, templates, where offered, variants), group slots with mode + room icons, branch /
  partner rooms tab, instructor working hours, calendar icons, room usage report, portal "next session: online — Join".
- Manual online: link per group (exists: `onlineMeetingUrl`), join log (exists: `OnlineJoin`), instructor marks the
  new states.

### M2 — meeting tools
`meeting.settings` (provider per company / group, thresholds), provider adapters `lib/meetings/{zoom,meet,…}.ts`,
`OnlineSession` (group, date, provider, externalId, joinUrl, hostJoinedAt, state), `OnlineAttendance` (enrollment,
joins Json, minutes, cameraOffMinutes?), `SessionRecording` (state PENDING_REVIEW / APPROVED / HIDDEN / DELETED,
visibleToStudents, deleteAfter, review rating → instructor performance). Late-instructor flow.
RISK: the late-instructor checks need a job every few minutes; Vercel cron here runs once a day → an outside scheduler
(e.g. cron-job.org calling a secret URL) or provider webhooks. Decide in M2.

### M3 — One-to-One
`ClassSection.kind` GROUP|ONE_TO_ONE (default GROUP), `BookingRequest` (student, level, mode, weekday + time, offers chain,
state), settings `oneToOne.settings` (assignWithoutAsking, cancelHours, postponesPerMonth, carryMonths, noShowLimit),
postponement = existing makeup / ExtraSession, rules acceptance = GroupRule, prices = place price list for 1:1.

### M4 — recorded courses, outside students, codes, partner shares
`CourseEnrollment` (student, level / course, SUBSCRIPTION|ONE_TIME, starts, ends, attribution place / partner),
watch tracking (extend LessonView / LessonProgress with seconds), protected video provider, single-device student login
(`User.activeSessionKey` checked in session-guard), `OfficeHour` + `OfficeHourBooking` + free credits per cycle, public
catalog + self sign-up + Paymob, `EnrollCode` + `EnrollCodeUse`, partner terms per student / group / mode.

## 3. Risks to keep in mind
- `Track.name` is unique: partner-specific tracks need distinct names.
- Adding enum values to `AttendanceStatus` is safe; never remove or rename them.
- Every new money route must be wrapped in `withMonthLock` (month close).
- Children's privacy: recordings, camera rule, consent, retention.
- External service costs (meetings, video) grow with hours — show the owner the numbers before choosing.
