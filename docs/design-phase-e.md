# Phase E — TechNova Passport, Profile & learning gamification

Status: POSTPONED (2026-10-05). The owner decided to build all of phase E together with Moodle. Every idea below is kept;
answers to the open questions + «ابدأ» are still needed when it resumes.

## Agreed so far
- The "student journey" becomes the **TechNova Passport + Profile**: one page per student.
- All suggestions are added, each with settings (on/off + thresholds):
  - badges;
  - track graduation;
  - achievement image for WhatsApp;
  - skills slot (filled by Moodle later);
  - leaderboard;
  - student project uploads;
  - Nova levels / XP;
  - paper passport;
  - digital student card;
  - "Year at TechNova" recap;
  - next-step booking;
  - goals;
  - instructor quotes.
- The work is split:
  - **E1 now (no Moodle):** passport, stamps, journey, tasks + projects from the system, badges / XP / streaks, transcript
    PDF, share link, achievement image, settings, learning gamification (below).
  - **E2 with Moodle:** tasks / quizzes / completion pulled automatically, skills radar from Moodle, a full recap.

## Passport (official, system-made)
- Identity page: photo, AR/EN name, registration no., QR, branch, join date, passport no. TN-PASS-YYYY-NNNN.
- Stamps: one per finished level (track colour, date, result); a gold graduation stamp per finished track
  (animated the first time).
- Certificates with QR verification. Official transcript PDF with the company stamp.

## Profile (living)
- Projects gallery: photos / short videos uploaded by the instructor, or by older students with instructor approval.
- Tasks: done / not done, mark.
- Skills radar: from the instructor's end-of-level rating now, from Moodle later.
- Instructor quotes collected from the reports.
- Goals chosen by the student or the parent, with progress.

## Gamification
- XP from attendance, tasks, perfect attendance and featured projects.
- Nova levels: Cadet → Explorer → Engineer → Inventor → Master.
- Badges.
- Attendance streak (resets on an unexcused absence).
- Leaderboard: optional, OFF by default.

## Visibility
- Share link: made by the parent, expires, can be revoked, shows no phone number or money.
- Grades, attendance and breaks are not on the share link.
- Phone number and money: parent and management only.

## Open questions
1. Is the E1 / E2 split OK?
2. Leaderboard: build it, OFF by default?
3. Who uploads projects: the student (with approval), or the instructor only?
4. Nova level names?
5. Paper passport for events?
6. Is Moodle running on a server now?
7. Journey questions 1–5:
   - where the passport is shown;
   - next-step suggestion;
   - transcript PDF;
   - session minutes per level;
   - breaks visible to staff only.
8. New (learning gamification): see the reply of 2026-10-04 — missions, challenges, rewards store, teams, seasons.

## More ideas recorded (2026-10-04/05)

### Passport / Profile
- The passport cover changes with the Nova level (Cadet blue → Master gold).
- "TechNova world" map: each track is a planet / island, each level a station.
- Student avatar robot: parts unlocked with badges / XP; shown in the passport and the leaderboard.
- School / university portfolio PDF for older students (projects, certificates, skills, instructor quotes).
- "Assistant instructor" / ambassador experience recorded in the passport.
- Competitions (from Events later): special stamp + rank.
- "People I worked with": teammates, thank-you notes from a teammate or the instructor.
- Inventor's diary: two lines after each session.
- "First times" album (first robot that moved, first code that ran).
- Physical badges (patches / pins) matching the digital badges, handed out at events.
- Digital student card (existing QR), achievement image for WhatsApp, "Year at TechNova" recap, next-step booking,
  goals, instructor quotes.

### Gamification
- Missions per level (E2 with Moodle).
- Challenges: weekly, group vs group, parent + child at home.
- Teams inside a group.
- Seasons of 3 months with a theme.
- Rewards store with Nova coins (admin-controlled items; a discount reward links to Discounts).
- Quick in-class quiz (E2).
- Hidden treasure codes (secret badges).
- Boss level (final project) and Demo Day with parent voting.
- "Help a classmate" XP, confirmed by the instructor.
- Age-appropriate challenges.
- No negative XP. Every comparison feature can be switched off.

### TechNova as a company (business ideas, owner to choose which the system supports)
1. Hotel / resort kids-club STEM programmes (Hurghada advantage) → phase F partners.
2. TechNova curriculum inside schools → phase F.
3. International competition team (WRO, FIRST LEGO League) → Events.
4. TechNova-certified levels as a recognised standard.
5. Train-the-trainer academy.
6. Kits / products store linked to the wallet.
7. Summer / winter camps → Events + referrals.
8. Real projects for local companies (older students) → portfolio.
9. Alumni community.
10. CSR sponsored seats.
11. Online content / paid online courses.


## Gamification system design (detailed, 2026-10-05)

1. **Two currencies.**
   - XP: never goes down; sets the Nova level.
   - Nova coins: spent in the rewards store; never converted to money; never in the wallet.
2. **Points engine.** A rules table the admin edits: event → XP / coins, a cap per period, on/off per rule.
   Starting rules:

   | Event | XP | Coins | Cap |
   |---|---|---|---|
   | present | 10 | 1 | |
   | on time | 5 | | |
   | perfect month | 50 | 10 | |
   | task done | 20 | 3 | |
   | score ≥ 90 % | +15 | 2 | |
   | project approved | 30 | 5 | |
   | featured project | 50 | 10 | |
   | challenge | per challenge | per challenge | |
   | help a classmate | 15 | 2 | max 3 / week |
   | star of the session | 20 | 3 | 1–2 per session |
   | referral | 100 | 20 | |
   | level completed | 200 | 30 | |

3. **Nova levels.**
   - Thresholds (settings): Cadet 0, Explorer 500, Engineer 1500, Inventor 3500, Master 7000.
   - Each level gets a new passport cover and avatar parts.
   - Level-up confetti + a parent notification.
4. **Badge builder (no code).**
   - A condition such as "attended N sessions" or "N challenges in a season".
   - Bronze / silver / gold tiers; secret badges; season-only badges.
   - Given automatically when the condition is met.
5. **Challenges.**
   - Created by an admin or an instructor.
   - Audience: all / branch / track / level / group / age range; start and end dates.
   - Submission: photo / video / text / code link / instructor confirms.
   - The instructor reviews (approve / reject with a note) → rewards.
   - Types: weekly, family (parent + child), group vs group, hidden treasure codes.
6. **Teams.** Inside a group only (no branch-wide houses: Houses were removed). The team total is the sum of its members.
7. **Seasons.**
   - Every 3 months, with a theme.
   - A season pass: free tiers unlocked by season XP, with small rewards.
   - Season leaderboard; season champions get a rare badge + a certificate at Demo Day.
   - XP itself is never reset.
8. **Rewards store.**
   - The admin adds items: name, picture, coin price, stock, age range, branch.
   - Flow: the student requests → staff approve → staff hand it over → "delivered".
   - Item types: physical; digital avatar part; extra session; discount (only if allowed; it links to Discounts).
9. **Instructor tools** on the attendance screen: "star of the session", "helped a classmate", "featured project"
   (all capped).
10. **Parents.**
    - See the level, XP, badges and open challenges.
    - Family challenges.
    - Notifications on level-ups and badges.
    - Can hide their child from leaderboards.
11. **Fairness.**
    - No negative XP, ever.
    - Leaderboards by age band, showing "first name + initial".
    - Every comparison feature has a switch and starts OFF.
    - Every point is logged (who / why / when); the admin can revoke points given by mistake.
12. **Management analytics.**
    - Engagement, which challenges work, the most requested rewards.
    - KEY: do high-XP students renew more and attend more? This measures whether gamification pays off.
13. **Moodle.** Any new source is just a new event / rule (lesson completed, quiz passed): no rebuild.

Proposed batches when it resumes:
1. engine + currencies + levels + badges + instructor tools + passport / profile;
2. challenges + projects + tasks + teams;
3. store + seasons + leaderboard + analytics.

Open decisions:
- two currencies;
- the cap for star of the session;
- a discount reward in the store;
- the leaderboard starting OFF;
- names (Nova coins, level names);
- the earlier E questions.
