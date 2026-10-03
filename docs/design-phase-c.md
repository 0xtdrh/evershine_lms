# Phase C — notifications, excuses, attendance, reports, feedback, dashboard, birthdays

Status: C1 IMPLEMENTED (2026-10-03, after the owner's «ابدأ»). C2 (session reports, homework, quizzes, skills) waits for Moodle.

## Owner answers so far

### Attendance in the portals
- Per-session table for the parent and the student: session N/M, date, status, excuse reason, attendance %.
- **No instructor name** in that table.

### Absence excuse
- The parent sends an excuse for a specific session from the portal. The instructor sees it on the attendance
  screen. The student is marked EXCUSED.
- Setting "automatic" vs "needs approval", by scope ALL / TRACK / COURSE / GROUP. The most specific scope wins
  (same idea as RefundRule / WalletRule).

### Reports (shown in the parent portal under "Reports", split by type, each one sends a notification, WhatsApp when the API exists)
- **Session report** (after every session):
  - what we did;
  - whether the previous homework was done (later from Moodle);
  - student rating;
  - instructor's word;
  - attendance;
  - the homework to do after this session.
- **Monthly report**: attendance, a summary of the session reports and a monthly instructor comment.
  It is skipped when the level is only one month long. The split follows the level length; it is not fixed.
- **Level report**:
  - attendance;
  - result;
  - summary of the session and monthly reports;
  - skills;
  - certificates;
  - recommendation for the next level.

### Feedback
- The student rates each session. The parent rates the session, the instructor and the company.
- The owner said: "I'm with you" on frequency and the details. Proposal:
  - the student answers 1 emoji question per session;
  - the parent answers for students under 8;
  - the parent gets 3 questions monthly and a longer survey at the end of the level;
  - a rating of 2 or lower → the manager is alerted and a contact-log follow-up is created;
  - the instructor sees averages only, without names.

### Birthdays (students, parents and staff)
- Page with today / this week / this month, filtered by branch and group. RBAC resource `birthdays` on the
  Permissions page.
- WhatsApp greeting button for the parent (one click). The automatic WhatsApp message comes once the Cloud API
  is set up.
- Print the existing birthday certificate (Documents) from the same page. It is also delivered to the parent and
  the student in the portal.
- The cron sends an in-portal notification to the student and the parent (not only email: many students have no
  email). The parent and student portals show a big greeting banner on the day.
- Born 29 Feb → greeted on 28 Feb in non-leap years. All date maths in Egypt time (Africa/Cairo).
- The same applies to parents and staff.
  - Guardian and Admin have NO dateOfBirth today → add optional fields (additive).
  - Teacher already has `dateOfBirth`.

### Extras chosen
1. Two absences in a row → staff alert + contact-log follow-up.
3. Staff birthdays.
4. "Perfect attendance" badge for the month.
5. Morning summary for the manager:
   - today's sessions;
   - yesterday's missing attendance;
   - overdue invoices;
   - receipts waiting.

### Technical notes
- Vercel Hobby allows 2 crons (db-backup and wallet-alerts are both used) → one daily dispatcher cron runs all
  daily jobs (wallet alerts, birthdays, morning summary, report reminders).
- Hosting will move off Vercel later; keep the jobs portable.
- Schema changes are additive only.

## Final answers (2026-10-03)
- Split agreed: **C1 now** = notifications + settings page; absence excuse; portal attendance table; birthdays
  (students, parents, staff); feedback (student per session, parent monthly + end of level); dashboard numbers;
  morning summary; 2-absences alert; perfect-attendance badge; simple monthly + level reports from data we
  already have (attendance, result, certificate, ratings). **C2 with Moodle** = session reports, homework,
  quizzes, skills (keep a slot for Moodle data, e.g. `homeworkSource`).
- Birthday discount: yes. It is a discount type on the Discounts page (on/off, value), like early renewal.
- Excuse time window (before the session / up to N days after): **configurable by the owner** (default up to
  2 days after), in the same scoped excuse settings (ALL / TRACK / COURSE / GROUP) as auto vs approval.
- Every absence counts against the student in refunds (seat was reserved), excused or not.
- Parents can NOT switch notifications off. Only the admin notification-settings page turns event types on/off.
- Rest as proposed:
  - lateness notification on;
  - student emoji per session (the parent answers under 8);
  - parent 3 questions monthly;
  - a rating of 2 or lower → manager alert + follow-up;
  - the instructor sees anonymous averages only.


## Implementation (C1, 2026-10-03)

### Schema (additive only)
- `User.dateOfBirth`: optional, for parents and non-teacher staff.
- New tables:
  - `AbsenceExcuse`;
  - `ExcuseRule`;
  - `SessionFeedback`: emoji rating 1..4;
  - `ParentSurvey`: 3 ratings 1..5, kind MONTHLY or LEVEL;
  - `BirthdayGreeting`: once per person per year.

### Notifications
- `lib/notifications/events.ts` holds:
  - the catalog `NOTIFICATION_EVENTS`;
  - the on/off switches in AppSetting `notifications.events`;
  - the senders `notifyFamilies` (parents, plus the student optionally, plus WhatsApp when configured) and `notifyUsers`.
- Page `/dashboard/admin/notifications`, API `/api/notifications/settings`. RBAC `notification_settings`.
- Hooked into:
  - attendance save (`lib/attendance/after-save.ts`): absent or late only when the status changed; absent twice in a row → staff alert plus a contact-log follow-up;
  - `createCycleInvoice`: new invoice;
  - substitute accepted;
  - session cancelled;
  - holiday added (`lib/notifications/session-events.ts`);
  - level-results: result, then the level report;
  - certificate reveal;
  - advance-cycle (`lib/groups/cycle-closed.ts`): monthly report, perfect attendance, "rate the month";
  - the wallet notifications and the renewal request are also switchable.

### Excuses
- `lib/excuses/rules.ts`: pure rule resolution and time window.
- `lib/excuses/engine.ts`:
  - `submitExcuse`, `decideExcuse`, `cancelExcuse`;
  - `excusableSessions`;
  - `excusesOn` (used by the roster and on save: an approved excuse turns ABSENT into EXCUSED).
- APIs:
  - `/api/absence-excuses` (+ `[id]`, `rules`);
  - `/api/guardian-portal/excuses` (+ `[id]`).
- Staff page `/dashboard/absence-excuses` (To review / All / Settings). Parent card in My Children → "Absence excuse" tab. RBAC `absence_excuses`.

### Attendance in the portals
- `lib/attendance/timeline.ts` (pure parts in `timeline-calc.ts`).
- API `/api/students/[id]/attendance-timeline`. Access check `lib/students/access.ts`: staff of the branch, the student's instructors, parents, the student.
- Component `AttendanceTimeline`: session N of M, date, status, excuse reason, %, perfect-attendance badge. No instructor name.

### Ratings
- `lib/ratings/engine.ts`. (`lib/feedback/*` is the OLD template teacher questionnaire, which is separate and untouched.)
- Settings in AppSetting `ratings.settings` (`parentAnswersUnderAge` 8).
- APIs:
  - `/api/ratings/parent` (GET/POST session or survey);
  - `/api/ratings/student`;
  - `/api/ratings/overview` (managers; `?mine=1` for an instructor's own anonymous averages).
- UI:
  - `ParentRatingsCard` on top of My Children;
  - `StudentRatingCard` on the student dashboard;
  - page `/dashboard/ratings`;
  - `TeacherRatingsCard` on the instructor dashboard.
- RBAC `ratings`.
- Low ratings (session 🙁, or any survey answer ≤ 2) → LOW_RATING alert plus a contact-log follow-up (reason COMPLAINT).

### Reports (automatic)
- `lib/reports/student-reports.ts`: `listReports`, `monthlyReport`, `levelReport` (with recommendation; `skills` and `moodle` = null slots for C2).
- API `/api/students/[id]/reports`. Printable page `/reports/student/[studentId]?kind=&group=`. List `StudentReportsList` in the portal "Reports" tab, on the student page and on the student dashboard.

### Birthdays
- `lib/birthdays/birthdays.ts`: `birthdayPeople`, `runBirthdayJob`.
- Date maths in `lib/dates/cairo.ts`: Egypt time; 29 Feb → 28 Feb in non-leap years.
- APIs:
  - `/api/birthdays` (page `/dashboard/birthdays`, RBAC `birthdays`; instructors see only their own students);
  - `/api/birthdays/me` (`BirthdayBanner`);
  - `/api/students/[id]/birthday-card` with page `/birthday-card/[studentId]`. The certificate design is shared with Documents through `components/documents/BirthdayCertificate.tsx`.
- Dates of birth:
  - API `/api/users/date-of-birth`;
  - Settings → "Date of birth" for yourself;
  - student page → "Parents' birthdays".
- Birthday discount: `discounts.rules.birthdayTypeId` on the Discounts page.

### Dashboard and daily job
- `lib/insights/insights.ts` and `/api/dashboard/insights`, shown by `RoleInsights` with numbers per role: managers, accountant, secretary, instructor.
- `lib/jobs/daily.ts` and `/api/cron/daily`: wallet alerts + birthdays + morning summary (once a day).
- `vercel.json` now runs `/api/cron/daily` at 06:00 UTC instead of wallet-alerts. The old route still works.

### Tests
- `tests/phase-c.test.ts`.
- e2e section 27.
