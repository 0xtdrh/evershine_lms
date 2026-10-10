# TechNova learning platform — final master plan (2026-10-05)

Covers: **LMS · Reports · Passport · Profile · Gamification**. It supersedes the scattered notes. Details stay in:
- `docs/design-lms.md` (LMS draft);
- `docs/design-phase-e.md` (passport / gamification ideas);
- `docs/design-phase-c.md` (reports done in C1).

Decisions are from the owner (chat 2026-10-03 → 2026-10-05) unless marked "proposed".

## 0. Principles
1. **One screen.** Students, parents, instructors and the curriculum team never leave TechNova. No Moodle (owner
   chose an in-house LMS + H5P + external tools).
2. **Built on what exists:**
   - Course Structure (Track > Course > Level);
   - Groups, enrolments and attendance;
   - grading config and level results;
   - certificates, the notifications catalog, permissions (RBAC), the wallet / discounts.
3. **One database, one login, the same security.** Every schema change is additive.
4. **Everything switchable.** Each feature has settings (on/off + thresholds) and permissions.
5. **Kid-friendly by age** (from date of birth): 4–7 pictures / audio / stars; 8–12 guided; 13+ full.
6. **Tested in batches.** Each batch ships with unit tests, an e2e section and a `live-check` demo before the next one
   starts.
7. **Portable.** File storage goes through one adapter: Cloudinary now, the Hostinger / own server later. Videos are
   on a video service.

## 1. Order of work
| Stage | Batches | Notes |
|---|---|---|
| 1 LMS core | L1 Curriculum · L2 Delivery & protection · L3 Assignments & projects · L4 Quizzes & exams | first |
| 2 Interactive + reports | L5 H5P / tools / video / online class · R1 Session report (C2) · R2 Report upgrades + skills | C2 lives here |
| 3 Passport & profile | P1 Passport · P2 Profile | |
| 4 Gamification | G1 Engine · G2 Challenges & teams · G3 Store, seasons, leaderboards, analytics | |
| then | Phase F: M0 branch scoping (must be done before real multi-branch use) + partners | |

---

## 2. LMS

### L1 — Curriculum library (authoring)
- **Structure = Course Structure page:**
  - Track > Course > Level > **Edition** > **Sessions** (count = the level's `numberOfSessions`) > **Blocks**.
  - The edition is a versioned curriculum: Draft → In review → Published → Archived.
  - A running group stays on the edition it started with; new groups take the newest.
- **Session fields:**
  - number, title AR / EN, objectives AR / EN;
  - duration (minutes → hours in the passport);
  - private instructor notes, materials / kits list;
  - skills practised.
- **Blocks:**
  - rich text (sanitised), image, video (video service), PDF / file, link, code snippet;
  - embed (allow-listed), H5P (L5), quiz (L4), assignment (L3), external tool (L5).
- **Bilingual.** Every text field has AR and EN; the student sees their language (switch).
- **Who edits.** Anyone with the new RBAC resource **`curriculum`**:
  - create / update = author;
  - approve = publish;
  - shown on the Permissions page.
- **Review flow.** Comments on a session; publish = a new published edition.
- **Tools:** duplicate a session / edition / level; reorder by drag; preview "as a student" per age band; JSON
  export / import (backup).

### L2 — Delivery, unlocking, protection
- **Instructor:**
  - today's session plan inside the attendance screen (objectives, steps, materials, notes);
  - unlock / lock buttons;
  - a group-only extra note or material (does not change the curriculum).
- **Student "My lessons"** (portal):
  - unlocked sessions as cards per group;
  - completion ticks per block / session;
  - lessons stay open after the session, for revision and for absent students (links with excuses).
- **Unlock modes** (default per level, override per group):
  - all at once;
  - on a date / time;
  - when attendance is recorded;
  - by the instructor;
  - after the previous session / quiz is completed or passed.
  - **Owner decision (2026-10-09): default = when attendance is recorded** (changeable per level / group).
- **Kid mode (4–7):** big pictures, audio button for instructions, one thing per screen, no typing.
- **Devices:**
  - home (normal login, mobile-friendly);
  - branch tablets: **quick login by scanning the student card QR** + auto sign-out after the session / idle time, so
    the next child is not on the same account.
- **Parent:** sees the sessions done, what was learned, the homework (read-only).
- **Content protection** (no technology stops a phone camera 100 %; this makes it hard and traceable):
  - **moving watermark on videos:** student name + username + date, semi-transparent, changes position every few
    seconds;
  - **watermark on all learning content** (images, PDFs, text): repeated name + username;
  - **no download:** videos streamed (HLS) with short-lived signed URLs locked to our domain; PDFs in an in-app viewer
    with no save / print; images through signed URLs (Cloudinary text-overlay watermark per student);
  - right-click, text selection and save / print shortcuts blocked; print CSS hides content;
  - access only for students enrolled in that group (+ assigned instructors, authors, managers);
  - every content view is logged (who / what / when) to trace leaks.

### L3 — Assignments & projects
- **Submission types:** text, photo(s), video, file, link (Scratch / Tinkercad / GitHub), "done in class" (the
  instructor ticks it).
- **Settings:** due date; late rule (allowed / marked late / closed); resubmission (on / off, max); group or
  individual.
- **Grading:**
  - points or a **rubric** (criteria × levels); stars / smileys for ages 4–7;
  - written feedback; "featured project".
- **Screens:** bulk grading per group; student "my assignments" with status; parent sees grades and feedback.
- **Reminders:** before the due date, on feedback (notifications catalog).
- **Projects gallery:**
  - visibility setting: own only / my group / everyone (per level or group);
  - the instructor approves before anything is shown.

### L4 — Quizzes & exams
- **Question bank** per course / level, tagged by skill and difficulty, bilingual.
- **Types, phase 1:**
  - single / multiple choice (text or picture);
  - true / false;
  - picture choice (ages 4–7);
  - ordering;
  - matching;
  - short answer;
  - numeric;
  - "what does this code print".
- **Types, phase 2:** drag onto an image (H5P); essay (manual grading).
- **Settings:**
  - time limit, attempts, scoring (best / last / average);
  - shuffle questions and answers, pass mark;
  - show answers (never / after submit / after close);
  - availability window;
  - kid mode (one question per screen + audio).
- **Anti-cheat:**
  - correct answers never reach the browser before submit; graded on the server;
  - the timer is enforced on the server; one active attempt; audit log.
- **Exam → level result** (the existing grading config: weights + pass threshold per course):

  | Result component | Filled from |
  |---|---|
  | homework | average of the level's assignments (L3) |
  | task | average of session quizzes + interactive activities (L4 / L5) |
  | project | the final project rubric (L3) |
  | MCQ | the end-of-level exam (L4) |
  | instructor | stays MANUAL (+ the instructor's feedback, needed for the certificate) |

  - Source flags become LMS. The instructor can override any score with a written reason (logged).
  - Retakes: number of attempts and best score from settings.
  - Fail → the level report says "repeat"; pass + feedback + last month → certificate (existing rule).
- **Item analysis** for managers: hardest questions, the most-chosen wrong answer.

### L5 — Interactive content, external tools, video, online classes
- **H5P:**
  - Authored with the free Lumi editor (or h5p.org), giving a `.h5p` file; uploaded into a block.
  - The server unpacks it to storage (adapter); shown with the **h5p-standalone** player in a sandboxed iframe.
  - xAPI score / completion is saved, feeding progress, the session report, XP and skills.
  - An in-app H5P editor can come later.
- **External tools**, three levels:
  1. embed (allow-listed, e.g. a Scratch project player);
  2. LTI 1.3 launch + grade return (checked per tool);
  3. link + submission (e.g. a Tinkercad design link).
- **Video service:** proposed **Bunny Stream** (cheap, token-protected HLS, domain lock), with our moving-watermark
  overlay. Alternatives: Cloudflare Stream, Vimeo; YouTube is too weak for the protection asked. Prices to check
  when subscribing. Owner confirmation needed.
- **Online classes:**
  - Proposed **Zoom** (paid account per class running at the same time; meeting embedded with the Zoom SDK; cloud
    recording attached to the session automatically).
  - Later, after moving to own server: **BigBlueButton** (free software made for teaching: whiteboard, polls,
    recording).
  - A meeting link is generated per online session; attendance can be marked from it.
  - Owner confirmation needed.
- **Storage adapter:** H5P packages / PDFs / submissions on Cloudinary now, own server later, with no app change.

## 3. Reports

Already live (C1):
- monthly and level reports (attendance, session ratings, result, certificate, recommendation);
- notifications; printable pages; portal "Reports" tab.

### R1 — Session report (C2)
Built automatically after each session. No typing, except optional instructor extras.
- **What we did:** from the curriculum session.
- **Attendance:** present / late / excused.
- **Previous homework:** done / late / missing + grade (L3).
- **Quiz / H5P results** of the session (L4 / L5).
- **Instructor:** star of the session / a quick comment / a ready-made phrase (one tap, optional).
- **Next homework:** from the curriculum.
- **Delivery:** in the portal "Reports" tab (session / month / level); a notification; WhatsApp once the API exists.
  The instructor has a short window to add a comment before it is sent.
- **Missing pieces:** managers see "reports not complete" (e.g. homework not graded) like "attendance missing".

### R2 — Report upgrades + skills
- **Monthly report:** + homework completion %, quiz average, projects of the month, skills progress, the best
  instructor quote.
- **Level report:** + exam result breakdown (the five components), skills radar, projects gallery, recommendation +
  next-step booking button (links with renewals).
- **Skills radar:** from the skills tagged on questions / assignments / H5P (per course skills list), shown in
  reports, passport and profile.
- **Staff analytics:**
  - lesson completion per group;
  - homework on-time rate;
  - quiz averages per group / instructor;
  - at-risk students (attendance + LMS activity + ratings) → follow-ups.
- **Instructor performance page:** group attendance, parent ratings, renewal rate, complaints, ungraded work,
  incomplete reports.

## 4. Passport (official record, system-made)

### P1
- **Identity:**
  - photo, name AR / EN, registration no., QR, branch, join date;
  - passport no. **TN-PASS-YYYY-NNNN**;
  - the cover changes with the Nova level (Cadet blue → Master gold).
- **Stamps:**
  - one per finished level (track colour, date, result);
  - a gold graduation stamp per finished track, plus a **graduation certificate**;
  - competitions stamp (from Events later);
  - stamp animation the first time.
- **Certificates:** all, with QR verification.
- **Official transcript PDF:** all courses / levels / results / certificates, company stamp.
- **Digital student card:** the existing QR, saved on the phone, used for attendance and tablet login.
- **Share link:**
  - made by the parent only; expires; can be revoked;
  - no phone number, money, grades, attendance or breaks;
  - the parent chooses whether projects / badges are shown.
- **Paper passport:** a printable booklet version, stamped at events.

### Visibility
| Section | Student | Parent | Instructor | Management | Share link |
|---|---|---|---|---|---|
| identity, stamps, certificates | ✅ | ✅ | ✅ | ✅ | ✅ |
| projects, badges, XP | ✅ | ✅ | ✅ | ✅ | the parent chooses |
| grades, tasks | ✅ | ✅ | ✅ | ✅ | ❌ |
| attendance, breaks | partly | ✅ | ✅ | ✅ (breaks: staff only) | ❌ |
| phone, money | ❌ | ✅ | ❌ | ✅ | ❌ |

## 5. Profile (the student as a person)

### P2
- **TechNova world map:**
  - tracks as planets / islands, levels as stations;
  - shows "you are here" + the next step;
  - the next-step suggestion is based on age (track min / max age) and results.
- **Projects gallery:** L3 projects + instructor uploads + older students' uploads (approved).
- **Tasks:** done / not done, grades (from L3 / L4).
- **Skills radar** (R2).
- **Instructor quotes** collected from reports.
- **Goals:** chosen by the student or the parent, with a progress bar.
- **Inventor's diary:** two lines after a session (optional, older students).
- **"First times" album:** first robot that moved, first code that ran (photo + date).
- **People I worked with:** teammates, thank-you notes (instructor-approved).
- **Experience:** assistant instructor / ambassador / alumni.
- **School / university portfolio PDF** (older students): projects, certificates, skills, quotes.
- **"Year at TechNova" recap** on the join anniversary (sessions, projects, certificates, badges).
- **Achievement image** for WhatsApp / stories with the TechNova logo (level finished, badge, graduation).

## 6. Gamification

### G1 — Engine
- **Two currencies (proposed):**
  - XP: never decreases; sets the Nova level.
  - Nova coins: spent in the store; never money; never in the wallet.
- **Rules table** (admin-editable, on/off, caps), starting values:

  | Event | XP | Coins | Cap |
  |---|---|---|---|
  | present | 10 | 1 | |
  | on time | 5 | | |
  | perfect month | 50 | 10 | |
  | lesson completed | 5 | | |
  | homework done | 20 | 3 | |
  | homework ≥ 90 % | +15 | 2 | |
  | quiz passed | 15 | 2 | |
  | H5P completed | 5 | | |
  | project approved | 30 | 5 | |
  | featured project | 50 | 10 | |
  | challenge | per challenge | per challenge | |
  | helped a classmate | 15 | 2 | 3 / week |
  | star of the session | 20 | 3 | 1–2 per session |
  | referral | 100 | 20 | |
  | level completed | 200 | 30 | |

- **Nova levels** (thresholds in settings): Cadet 0 → Explorer 500 → Engineer 1500 → Inventor 3500 → Master 7000.
  Level-up confetti + a parent notification + new passport cover + avatar parts.
- **Badge builder (no code):**
  - a condition (count of an event, optionally in a period / season);
  - bronze / silver / gold tiers; secret badges; season badges;
  - auto-awarded; physical patch / pin version handed out at events.
- **Streaks:** consecutive attended sessions; an unexcused absence resets them.
- **Instructor tools** on the attendance screen: star of the session, helped a classmate, featured project (capped).
- **Fairness:**
  - never negative XP;
  - every point logged (who / why / when); the admin can revoke mistakes;
  - leaderboards by age band, showing "first name + initial";
  - every comparison feature starts OFF; parents can hide their child.

### G2 — Challenges & teams
- **Challenges:**
  - created by an admin / instructor;
  - audience: all / branch / track / level / group / age range; start and end dates;
  - submission: photo / video / text / code link / instructor confirms;
  - review approve / reject with a note → rewards.
- **Types:**
  - weekly challenge;
  - family challenge (parent + child);
  - group vs group;
  - hidden treasure codes (secret badges);
  - **boss level** (final project shown at Demo Day).
- **Teams inside a group** (no branch-wide houses).
- **Demo Day:** schedule, presentations, parent voting.

### G3 — Store, seasons, leaderboards, analytics, avatar
- **Rewards store:**
  - items with name, picture, coin price, stock, age range, branch;
  - flow: request → approve → hand over → delivered;
  - types: physical, avatar part, extra session, discount (only if switched on; links to Discounts).
- **Seasons (3 months, themed):**
  - a free season pass with tiers;
  - a season leaderboard;
  - season champions → a rare badge + a certificate at Demo Day;
  - XP is never reset.
- **Leaderboards:** group / branch / age band; OFF by default.
- **Avatar robot:** parts unlocked by badges / levels / store; shown in the passport and the leaderboards.
- **Analytics:**
  - engagement, which challenges work, the most requested rewards;
  - **whether high-XP students renew and attend more**: does gamification pay off?

## 7. Security summary
- RBAC everywhere (new resources: `curriculum`, `lms_grading`, `gamification`, `passport_share`, …, on the
  Permissions page).
- Enrolled-only content; signed, expiring URLs; watermarks; view logs.
- Server-side quiz grading; sanitised HTML; sandboxed H5P / embeds; upload type / size checks; rate limits.
- Audit logs for grade overrides and point revokes.
- Share links without sensitive data.

## 8. Testing and rollout
- Each batch:
  - unit tests (pure maths: grading, unlocking, XP rules, badges);
  - an **e2e section** in `scripts/e2e/daily-cycle.sh`;
  - a `live-check --<batch>` demo;
  - a build + tsc baseline check;
  - the owner tests live → next batch.
- Demo data is always removable with `--cleanup`.

## 9. Decisions still needed from the owner
1. Video service: **Bunny Stream** (proposed)?
2. Online classes: **Zoom now, BigBlueButton later** (proposed)?
3. Gamification:
   - two currencies?
   - the star-of-the-session cap (1 or 2)?
   - may the store give invoice discounts?
   - names (Nova coins; Cadet … Master)?
4. Projects: may older students upload their own (with approval)? (proposed yes)
5. Paper passport for events? (proposed yes)
6. Session report: send automatically, or after the instructor confirms? (proposed: automatically after a short window)

## 10. Owner answers (2026-10-05) — these override the sections above
- **Age modes are customizable.** Settings define the age bands (from–to) and, per band, the UI mode (pictures +
  audio + stars / guided / full) and the grading style (stars / points). The 4–7 / 8–12 / 13+ split is only the
  default.
- **Block visibility.** Every content block has "shown to": instructor only / students only / both (parents follow
  the student view). The instructor's lesson plan = instructor-only blocks + shared blocks.
- **Gated progress (setting).** The next session can stay locked until the required homework and / or quiz of the
  previous session are done (or passed). Configurable per level / group / session; not always on.
- **Profile merged into the Passport.** ONE "TechNova Passport" holding:
  - identity, stamps, certificates;
  - **achievements / badges, competitions, instructor quotes, projects gallery, tasks, skills**;
  - plus the map, goals, diary, "first times", people, portfolio PDF and year recap from §5.
  §4 and §5 are now one module (P1 + P2 → the Passport).
- **Badges:** a large built-in set + the admin can add new ones (badge builder).
- Decisions:
  1. Video: **Bunny Stream** ✅.
  2. Online classes: **Zoom now, BigBlueButton later** ✅.
  3. Gamification:
     - **two currencies** ✅;
     - **no "star of the session"** (removed from the rules and the instructor tools);
     - store discount rewards: decided per reward by the owner, details when we reach G3;
     - names OK (Nova coins; Cadet → Explorer → Engineer → Inventor → Master) ✅.
  4. Students uploading their own projects: **a setting** (with instructor approval).
  5. Paper passport: ✅, printable from the system.
  6. Session report sending: **a setting** (automatic after a short window / after the instructor confirms).
- Status: foundations done (2026-10-08); **L1 built (2026-10-09)**, see "L1 as built" below.

### L1 as built (2026-10-09)
- Tables: `CurriculumEdition`, `CurriculumSession`, `CurriculumBlock`, `CurriculumComment`, `CourseSkill`,
  `ClassSection.curriculumEditionId` (pinning is used from L2/L3; null = newest published).
- Code: `lib/curriculum/blocks.ts` (pure rules: block types + zod per type, embed allow-list, YouTube/Vimeo → embed,
  status machine, tests in `tests/curriculum-blocks.test.ts`), `lib/curriculum/engine.ts` (tree, editions, sessions,
  blocks, comments, export/import, `editionForGroup`), APIs under `/api/curriculum/*`.
- Pages: `/dashboard/curriculum` (tree), `/dashboard/curriculum/level/[levelId]` (versions, publish, export/import,
  course skills), `/dashboard/curriculum/session/[id]` (editor, instructor / student preview, review comments).
- Rules: only DRAFT is editable; submit needs a title on every session; publish archives the previous published
  version; instructors (curriculum:read) see only published / archived versions of the levels they teach, substitute
  in or are qualified for; instructor notes + instructor-only blocks never reach the student view.
- Media: uploaded straight to Cloudinary as `authenticated` (private) in folder `<base>/curriculum`; the server adds a
  signed link only for viewers allowed to see the session. Video download / right-click off. Watermark = L2.
- Authoring works while the `lms` module is OFF (staff prepare content); the module will gate the portal in L2/L3.
- Not in L1 (later stages): QUIZ (L4), ASSIGNMENT (L3), H5P / TOOL (L5) are placeholders; age-band preview comes with
  the age modes; drag-and-drop reorder is up / down buttons for now.

### L2 as built (2026-10-09)
- Tables (additive): `LessonUnlock` (instructor OPEN / LOCKED per group + curriculum session number), `GroupLessonNote`,
  `LessonProgress` (student ticks per block), `LessonView` (log: SESSION / MEDIA, ip, device),
  `Level.lessonUnlockMode`, `ClassSection.lessonUnlockMode` (null = level / company default). Settings `lms.settings`
  (unlockMode default ATTENDANCE, watermark on, kidModeMaxAge 7).
- Numbering: a MONTHLY level is several groups; this group's curriculum sessions are (cycle-1) × perCycle + 1 …;
  earlier months stay open (revision), later months locked. Held count = same maths as the calendar (occurrencesFor).
- Pure rules `lib/lms/unlock.ts` (tests `tests/lms-unlock.test.ts`), engine `lib/lms/engine.ts`. The group's curriculum
  version is pinned when it has started; advance-cycle copies the pin + mode to the next month of the same level.
- Staff: lesson panel inside both attendance screens (`components/lms/GroupLessonsPanel.tsx`, API
  `/api/groups/[id]/lessons` + `/notes`): next lesson + link to the full plan, open / lock / automatic per lesson,
  group-only notes, mode per group (managers). Instructor, confirmed substitute, branch manager, admins only —
  **secretaries get nothing (owner: attendance only)**. Settings page `/dashboard/admin/lms` (company + per level).
- Students: `/dashboard/my-lessons` (+ `/[sessionId]?g=`), APIs `/api/lessons/my`, `/api/lessons/[sessionId]`,
  `/api/lessons/progress`, `/api/lessons/media/[blockId]` (checks access, logs, redirects to a signed private link;
  images get the student's name burned in by Cloudinary). Only while the `lms` module is ON (menu item hidden too).
- Protection: watermark with name + registration number (moving on video / embeds / PDF, repeated on text / images),
  right-click / copy / drag / Ctrl+S/P/C/U blocked, nothing printed, instructor-only content never sent.
  Limits (said honestly): Cloudinary free has no expiring links, so a copied file link keeps working; phone cameras
  cannot be stopped — the watermark + view log make leaks traceable.
- Kid mode (age ≤ setting): bigger text, one item per screen with Next / Back, read-aloud button (browser voice).
- Parent: `/dashboard/my-lessons` → choose child → what was learned (titles + objectives + progress), read-only.
- Left for L2b: quick QR sign-in on branch tablets (needs a registered-tablet design), a staff page to browse the

### L3 decisions (owner, 2026-10-10)
- Each part of a homework says how it is graded: automatic (questions, later code / tool checks), the instructor,
  or both (automatic score = a suggestion the instructor confirms). Auto-check can be switched on / off per homework.
- Auto-check conditions: a fixed correct answer or a measurable result defined in advance (answers + accepted
  alternatives + number tolerance; code test cases; tool checklists); same result every time; anything needing
  judgement goes to the instructor.
- Code editor: Python + JavaScript run and auto-graded in the browser (Pyodide / sandbox, default "auto + review");
  Arduino = syntax check. Auto-check of tool projects: Scratch (link / .sb3), MakeCode, App Inventor (.aia), Snap!,
  GitHub; Tinkercad / Wokwi / Code.org = instructor. A separate isolated runner (Judge0) may come after launch.
- Late rule, late penalty %, handing in again: settings (company > level > group). Late hand-ins still count.
- Final project = a normal homework flagged "final project" (fills the level's project score); a special page later
  with the passport.
- Projects gallery: approved by the instructor; visibility own / group / all; first name only; emoji reactions only;
  "no marketing" students never outside their group.
- Extras accepted: parents hand in for young children, voice feedback, rubric library, code-similarity alert,
  instructor reminder after 48 h, excused absence extends the due date, autosave.
- Delivery in two batches: batch 1 = homework, hand-in, instructor grading + rubrics, settings, notifications,
  level scores; batch 2 = code editor, tool auto-checks, gallery, similarity, voice feedback.

### L3 batch 1 as built (2026-10-10)
- ASSIGNMENT block = the homework (`lib/assignments/rules.ts`: zod schema, question grading, rubric, late / resubmit
  policy, tests `tests/assignments-rules.test.ts`; `lib/assignments/engine.ts`). Tables `AssignmentSubmission`
  (DRAFT / SUBMITTED / RETURNED / GRADED, attempts + history), `AssignmentDue`, `Rubric`, `AssignmentNotice`.
- Hand-in kinds: written answer, files, photos (camera on phones), video, links, done in class, + questions
  (single / multi / true-false / number ± tolerance / short answer with Arabic normalisation). Correct answers never
  reach the browser. Files are private Cloudinary uploads signed into the student's own folder.
- Grading: points, rubric (copy kept in the homework), or stars; automatic score change needs a written reason;
  "send back for changes" with a note; late penalty applied automatically.
- Due date: group date or start of the next session; excused absence adds `excuseExtensionDays`. Policy settings
  AppSetting `lms.assignments` (company / levels / groups).
- Pages: student / parent `/dashboard/my-assignments` (+ inside each lesson), staff `/dashboard/assignments`
  (gradebook, grade & next, due date, done in class, group rules for managers — not secretaries), rubric library
  `/dashboard/admin/rubrics`, homework rules in LMS settings.
- Notifications (daily job, never repeated): new homework, due within a day, graded / sent back, instructor reminder
  after 48 h. Level results: LMS homework % and project % next to the inputs ("use"), source saved as LMS.
- Release settings (owner 2026-10-10, in the homework rules): correct answers shown never / after handing in / after
  the due date / after the next session (default after the due date); grade + feedback shown as soon as graded /
  after the due date / after the next session (default at once). Hidden results say "result on …"; the family is
  notified when the result becomes visible (daily job, notice kind RESULT). Unknown dates = shown, never hidden forever.
  view log, homework list for parents (comes with L3).

## 11. Owner answers (2026-10-08)
- **Free first, paid later.** Every external service sits behind an adapter / setting, so switching does not need a
  rebuild:
  - video: Cloudinary free (signed adaptive streaming + our watermark) → Bunny Stream later;
  - online classes: Jitsi link in a new tab (free) → Zoom (embedded + cloud recording) later → BigBlueButton after the
    own server;
  - files: Cloudinary free → own server after Hostinger;
  - H5P / Lumi / Scratch / Tinkercad are free.
  Free-tier limits must be re-checked when each batch is built.
- **External tools library:** the admin adds ANY tool (name, icon, URL, integration level embed / LTI / link,
  allowed domain); authors pick tools from the library. Scratch / Tinkercad are only examples.
- **Launch waits until the LMS is finished.** Order: L1–L4 → L5 + R1 + R2 → Passport → Gamification → phase F
  (M0 + partners) → full pre-launch test → launch. Then the post-launch list in the chat of 2026-10-08:
  - WhatsApp API, Paymob live, PWA;
  - make-up sessions, trial session, instructor performance;
  - Hostinger, events, inventory, accounting exports, template clean-up, periodic security review.
- **Launch setup:** ONE main branch + partner academies. So phase F (M0 + partners) must be done before launch.

## 12. New requirements (owner, 2026-10-08)

### 12.1 In-system code editor (L3 / L5)
- Students submit code in an editor inside TechNova (syntax colouring, AR / EN UI). Code is a new submission type and
  quiz block.
- **Run it in the browser (free, sandboxed, nothing runs on our server):**
  - Python (Pyodide);
  - JavaScript / HTML (sandboxed iframe);
  - Blocks (Blockly) for young kids.
- **Robotics / electronics:**
  - **Syntax check** for Arduino C/C++ and MicroPython (micro:bit) inside the editor (a parser running in the browser
    marks errors with line numbers);
  - **full compile** check with `arduino-cli` on our own server after the move to Hostinger;
  - **simulation** through Wokwi (tools library) where needed.
- The instructor sees the code, the output / errors and the run history, then grades with a rubric.
- Auto-tests (optional per exercise): expected output → automatic score.

### 12.2 AI in several forms (later stage; each switchable, with a usage budget and cost cap)
- **Students:** a tutor that gives hints, not answers, grounded in the lesson and age-safe; a code-error explainer;
  practice-question generator.
- **Instructors:** draft quiz questions from a lesson; suggested rubric grades + feedback (the instructor confirms);
  session-report comment drafts.
- **Curriculum team:** AR ↔ EN translation; lesson / H5P drafts; simplify a text for an age band.
- **Staff:** complaint summaries + suggested replies; reply drafts to parents; churn-risk students.
- **Management:** ask questions about the data in plain Arabic ("how much did branch X collect last month?").
- **Parents:** a weekly summary of the child's progress in simple Arabic.
- **Rules:**
  - minimum personal data sent;
  - logs of every AI call;
  - per-feature on/off;
  - a monthly cost cap;
  - a human confirms anything sent to parents or any grade.
- **Provider:** Claude API (paid per use); a small free / low-cost trial first.

### 12.3 Platform subscription fee (finance)
- Setting on/off. A fixed monthly fee per student ("platform fee"). When ON it is mandatory for every active student.
- Billed monthly; paid through the wallet like everything else.
- Unpaid → after a grace period the portal turns read-only (proposed). Exemptions / discounts via the existing
  discounts.

### 12.4 Add-ons the parent / student can buy
- An add-ons catalog: event / party tickets, extra session, kit, printed certificate / passport, camp, …
- Bought in the portal with the wallet or online payment; staff manage items, stock and dates.
- Later, in the Events system: public bookings by people who are not students.

### 12.5 Usage analytics
- Per student / parent / instructor:
  - logins count;
  - session time;
  - last login;
  - most-used pages;
  - LMS time on lessons;
  - device type.
- Periods: today · last 3 days · this week · last 2 weeks · this month · last 3 / 6 / 12 months.
- Lists: most active / inactive (e.g. parents who never opened the portal, instructors not logging in), per branch /
  group.
- Tracking: a login event + a light activity "heartbeat" while the page is open. Stored compactly. Retention period in
  settings.

### 12.6 Treasury, cash flow and budget (linked to accounting)
- **Money accounts:** cash box per branch, each bank account, e-wallets (Vodafone Cash / InstaPay …), the online
  gateway balance (Paymob).
- **Student wallets are shown separately as money owed to customers** (a liability): not the company's own cash.
- **Every movement posts to an account automatically:** payment (into the account it was received in), refund,
  expense, salary, wallet withdrawal.
- **Transfers between accounts** (e.g. branch cash → bank deposit, gateway → bank) with approval and attachment.
- **Balances now**, cash-flow statement (in / out by period, by category / branch), reconciliation (counted cash vs
  system).
- **Budget:** planned vs actual per category / branch / month.
- **"Where is every pound":** one page that adds up every account + the wallet liability.
- Linked to the existing expenses, salaries, P&L and financial reports.

### Proposed place in the order
- Code editor → inside L3 (submissions) and L5 (run / syntax / simulation).
- Usage analytics → with R2.
- Platform fee + add-ons + treasury / cash flow → a new **FIN** stage after gamification, before phase F (all needed
  before launch).
- AI → after launch, starting with the instructor and curriculum helpers (proposed; owner to confirm).

## 13. Owner answers (2026-10-08, b)
- **Platform fee, unpaid:**
  - grace period with warnings + notifications;
  - the reaction after the grace period is a setting: read-only portal / portal closed with a "please pay the platform
    fee" message / other options (e.g. LMS locked but finance pages open).
- **Treasury accounts:** fully configurable in settings (add / remove cash boxes, banks, e-wallets, gateways).
- **AI:** after launch.
- **Order:** confirmed (code editor in L3 / L5, usage analytics with R2, FIN stage after gamification and before
  phase F, AI after launch).

## 14. Foundations agreed before starting (owner, 2026-10-08)
1. **Arabic portal UI (RTL) + EN switch.** Built into L1 so every new screen is bilingual from the start; the existing
   portal screens are translated as they are touched.
2. **Media consent:** the PARENT approves, per child, where photos / videos / projects may be shown (group only /
   inside TechNova / marketing), plus a privacy policy.
3. **Pilot level:** write one full level (e.g. Robotics Level 1) right after L1 + L2 and run it with one real group
   before mass content writing.
4. **One settings centre** with sections. The whole system and the dashboard will be reorganised later (owner).
5. **Master switches** per big module: LMS, gamification, passport, platform fee, …
6. **Soft launch** with a small number of families for ~2 weeks before the full launch.
7. **In-app help:**
   - a first-time tour per screen;
   - short "how to" videos;
   - a **system guide document**;
   - **rules** (company rules + clearly explained rules for parents, accepted in the portal).
8. **File backups** (videos / PDFs / submissions), not only the database.

## 15. Pre-launch extras (owner, 2026-10-08)
1. **Own TechNova domain** for the portal (+ emails / messages from the domain) before launch.
2. **Monitoring** (free tiers):
   - uptime alerts;
   - error tracking.
   Users NEVER see technical errors, only a friendly message. Details go only to the monitoring / admin.
3. **Data migration** of current students + history (finished levels, old certificates, attendance if available)
   before launch, so the passport is complete from day one. Source to be confirmed by the owner (Excel / paper /
   another system).
4. **Editable message templates** (AR / EN) for every notification / WhatsApp text, in settings.
5. **Dynamic roles** (add / remove roles from the UI) in phase F with partners.
6. **Partner co-branding** on reports / transcripts: switchable per partner (on / off).

## 16. Agreements the parent must accept (owner, 2026-10-08)
- At the parent's FIRST portal login (and whenever a document changes) a full-screen step blocks the portal until the
  parent accepts the mandatory agreements.
- **Agreements centre (settings):** the admin writes and edits each agreement (AR / EN): company rules for parents,
  privacy policy, media consent, platform-fee terms, …
  - each has a **version**;
  - a "mandatory" flag;
  - a target audience (parents / students / staff).
- **Media consent:** the parent must actively CHOOSE an option per child (only us / group / all TechNova /
  marketing + share link); there is no skipping. They can change it later from the portal.
- **New version published** → the parent must accept again at the next login (optionally a short grace period).
- **Proof is stored:** who accepted, which version, date / time, device.
- **Staff screens:**
  - who accepted / who is still pending;
  - reminders;
  - export.
- The existing student rules blocker (`RulesAgreementBlocker`, template) is replaced by / merged into this.
- Built with the foundations at the start (with the Arabic portal), so it exists before any photo is uploaded.

## 17. Media consent = mandatory, no choice (owner, 2026-10-08) — overrides §14.2 and §16
- The media agreement is ONE mandatory text: TechNova films / photographs sessions and may use the material in the
  passport, galleries, reports and marketing. The parent must accept it to use the portal. There are no per-child
  options and no opt-out choice for the parent.
- Kept from §16: versioning, re-acceptance on change, proof (who / version / time / device), pending list, reminders.
- Proposed (owner to confirm): a staff-only flag per child "do not use in marketing" for rare exceptions agreed
  offline; the agreement text reviewed by a lawyer (Egypt personal data law 151/2020; children's data needs the
  guardian's consent).
- Owner accepted (2026-10-08): the staff-only "do not use in marketing" flag per child is in. **Do NOT start any
  implementation until the owner explicitly says so** (plan complete, work on hold).
