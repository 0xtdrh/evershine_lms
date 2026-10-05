# TechNova LMS — full plan (draft 2026-10-05)

Status: DRAFT. The owner chose **way 3** (2026-10-05): a TechNova LMS built inside the system, plus H5P for interactive
content, plus external tools by link / LTI. **No Moodle.** Order chosen by Claude (the owner delegated the choice):
**LMS → session reports (C2) → phase E (Passport / Profile / gamification) → phase F (branches M0 + partners)**.
M0 must still be done before the system is used by several branches for real. Needs the answers in §11 and «ابدأ».

## 1. Goals
- One screen for everyone: students, parents, instructors and the curriculum team never leave TechNova.
- Content is written once per level and reused by every group of that level.
- Results flow automatically into the session report, the level result, certificates, the passport and gamification.
- Few moving parts: one database, one login, the same permissions, sessions and security as today.
- Kid-friendly: picture-based for ages 4–7, guided for 8–12, full tools for 13+.

## 2. Why not Moodle (the decision)
- A hidden Moodle means a second app and database to sync; sync is the main source of errors.
- It needs a self-maintained PHP server (VPS); unpatched servers are the main security risk.
- One-screen requires building our own UI anyway.
- H5P (the interactive engine Moodle uses) works without Moodle.
- External tools plug in by link / embed / LTI 1.3.

## 3. Roles and permissions (new RBAC resources)
| Who | Can |
|---|---|
| Curriculum author (`curriculum:create/update`) | write and edit lessons, quizzes, assignments, H5P for levels |
| Curriculum reviewer (`curriculum:approve`) | approve and publish an edition |
| Instructor | sees the lesson plan of their groups, unlocks lessons, grades, gives feedback; cannot edit published content (can add a group-only note or extra material) |
| Student | sees unlocked lessons, does activities, submits, takes quizzes |
| Parent | sees the child's progress, results and feedback, read-only |
| Managers | analytics, every group |

## 4. Content model (all additive tables)
- **Track > Course > Level** (existing) **> Edition > Session (lesson) > Blocks / Activities**.
- **Edition**: a versioned copy of a level's curriculum (Draft → In review → Published → Archived).
  - A group is pinned to the edition published when it starts, so editing never breaks a running group.
  - New groups take the newest edition.
- **Session (lesson)**: number, title (AR / EN), objectives, duration (minutes; also feeds "hours" in the passport),
  instructor notes (private), materials list (kits needed).
- **Blocks** (ordered): rich text (sanitised), image, video, file, link, code snippet, embed (allow-listed sites),
  H5P package, quiz, assignment, external tool.
- **Skills**: each course has a skills list. Questions, assignments and H5P activities are tagged with skills, which
  feeds the skills radar.
- **Templates**: copy a level / edition to start a new one; import / export JSON for backup.

## 5. Modules (build batches)

### L1 — Curriculum library (authoring)
- Pages: Curriculum → track / course / level → editions → sessions; block editor (drag to reorder); preview as
  student (by age band); review / publish flow with comments; duplicate session / edition; bilingual fields.
- Media: images and files on Cloudinary (signed, private where needed). Video: see §11 Q2.
- Validation: sanitised HTML (XSS-safe), file type / size limits, embed allow-list.

### L2 — Delivery (classroom + portal) and progress
- Instructor: today's session plan inside the attendance screen (objectives, steps, materials, notes). One tap
  "unlock for the group" or automatic unlock (rule, §11 Q4).
- Student portal "My lessons": per group, unlocked sessions as cards; kid mode (big pictures, audio button for
  instructions, few words) for ages 4–7.
- Completion tracking per block / session (viewed, done, passed).
- Restrict access: unlock by attendance / date / instructor / passing a previous quiz.
- Parent view: sessions done, what was learned, the homework.
- Absent student: the lesson stays available to catch up (links with excuses and make-up sessions).

### L3 — Assignments and projects
- Submission types: text, photo(s), video, file, link (Scratch / Tinkercad / GitHub), "done in class" (the instructor
  ticks it).
- Due date, late rule (allowed / marked late / closed), resubmission (on / off, max).
- Grading: points or a rubric (criteria × levels), written / voice feedback, "featured project" (feeds the gallery
  and XP later).
- Bulk grading screen per group; reminders before the due date; parent notification on feedback.
- Projects gallery per student (photos / videos), visibility controlled.

### L4 — Quizzes and exams
- Question bank per course / level, tagged by skill and difficulty.
- Question types, phase 1:
  - single / multiple choice (text or picture);
  - true / false;
  - picture choice for young kids;
  - ordering (steps);
  - matching;
  - short answer (exact / list);
  - numeric;
  - "what does this code print".
- Question types, phase 2: drag-onto-image (via H5P), essay (manual grading).
- Quiz settings: time limit, attempts, best / last / average, shuffle questions and answers, pass mark, show answers
  after (never / after submit / after close), availability window, kid mode (one question per screen + audio).
- Security: correct answers never sent to the browser before submit; server-side grading; attempt timer enforced on
  the server; one active attempt; audit log.
- **Level exam → level result:** the end-of-level exam fills `StudentLevelResult.mcqScore` (and homework / task scores
  from L3) automatically (source = LMS instead of MANUAL), so certificates follow the existing rules.
- Item analysis for managers (hardest questions, most-chosen wrong answer).

### L5 — Interactive content, external tools, session report (C2), skills
- **H5P:**
  - Authoring with the free **Lumi** desktop editor (or the h5p.org editor), exporting a `.h5p` file.
  - Upload into a lesson block. The server unpacks the package and stores it (§11 Q7).
  - Shown with the **h5p-standalone** player inside our page (sandboxed iframe).
  - xAPI results (score / max / completion) are captured and saved, feeding progress, the session report, XP and
    skills.
  - An in-system H5P editor can come later (`@lumieducation/h5p-server`).
- **External tools**, three levels:
  1. embed (allow-listed, e.g. a Scratch project player);
  2. LTI 1.3 launch with grade return, for tools that support it (checked per tool);
  3. link + submission.
- **Online class**: an auto-generated meeting link per session (Jitsi free / Google Meet / Zoom; §11 Q8); attendance
  can be marked from it.
- **Session report (C2):** built automatically from curriculum (what we did, next homework) + attendance + homework
  status (L3) + quiz / H5P results (L4 / L5) + the instructor's star / comment. Sent to parents (notification;
  WhatsApp when connected).
- **Skills radar:** from tagged questions, assignments and H5P results.

### L6 — Passport / Profile / gamification
See `docs/design-phase-e.md`: the points engine listens to LMS events (lesson done, quiz passed, assignment graded,
featured project).

### Later (optional)
- Group discussion board (moderated, kids-safe).
- Messages with the instructor.
- PWA app with push notifications.
- In-system H5P editor.
- Learning analytics (at-risk students from attendance + LMS activity).

## 6. Integration with what exists
- Groups / enrolments → who sees what.
- Attendance → unlocking + session report.
- Excuses → catch-up lessons.
- Level results / certificates → filled from the exams.
- Notifications catalog → new events: lesson unlocked, homework due, feedback given, quiz result, session report.
- Reports (monthly / level) → the `moodle` slot becomes `lms` data.
- Ratings, complaints, wallet: unchanged.
- The e2e test gets a section per batch; `live-check --lms-*` demo data per batch.

## 7. Security
- Content only for enrolled students / assigned instructors / authors.
- Signed, expiring file URLs.
- Server-side quiz grading; answers hidden.
- Sanitised rich text; H5P in a sandboxed iframe on our domain.
- Upload type / size checks.
- Rate limits on submissions.
- Audit log for grade changes.
- The same RBAC and session guard as today.

## 8. Kids UX (age bands from the student's date of birth)
- **4–7:** pictures, audio instructions, one thing per screen, big buttons, no typing (picture answers).
- **8–12:** guided steps, short text, badges.
- **13+:** full text, code, files, deadlines.

## 9. Performance and hosting
Works on the current hosting (Vercel + Aiven + Cloudinary). Heavy files (videos, H5P packages) live outside the
database (§11 Q2, Q7). Portable to Hostinger later.

## 10. Rough size
L1–L4 is the core: several delivery batches, each tested (unit + e2e) before the next. L5 next, then L6.
This is the largest piece of work so far.

## 11. Open questions for the owner
1. Who writes content: a curriculum team, the instructors, or both with review?
2. Videos: YouTube unlisted (free, link shareable), Vimeo (paid, protected), or Cloudinary (protected, pay per
   storage / views)?
3. Where students use it: tablets / laptops at the branch, at home, or both?
4. When does a lesson unlock: automatically when the session is held (attendance), on its date, or by the instructor?
5. Content language: Arabic, English, or both per lesson?
6. Should the level exam replace the manual result entry (when a level has an exam)?
7. H5P / large-file storage: Cloudinary (already used) or a dedicated file store (e.g. Cloudflare R2 free tier)?
8. Online classes needed? If yes: Jitsi (free), Google Meet or Zoom?
9. Grading for the youngest: stars / smileys instead of numbers?
10. Can students see each other's projects (class gallery), or only their own?
