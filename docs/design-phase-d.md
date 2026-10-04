# Phase D — referral, end-of-level rating, complaints & suggestions

Status: IMPLEMENTED (2026-10-04, after the owner's «ابدأ»). e2e section 28.

## Owner answers

### Referral
1. Reward for the parent who refers = **wallet credit**. It can be **switched on/off** (settings), with the amount set there.
2. The new student gets a **welcome discount** on the first month. It can also be **switched on/off**.
3. The reward is given when the new student **pays the first invoice**.
4. **No limit** on the number of referrals per parent.

### Complaints & suggestions
5. The first receiver is the **secretary**, or a staff member who has the complaints permission
   (new RBAC resource, e.g. `complaints:handle`). If there is no answer within the deadline → escalated to the branch manager.
6. **Students and parents** can both send.
7. **No anonymous messages**: everything is shown with the account that sent it.
8. The instructor does **not** see complaints about him (managers only).

### Extras chosen
9. "Would you recommend TechNova to a friend? 0–10" in the end-of-level survey. A 9–10 answer shows the referral code.
10. "TechNova Ambassador" badge for a parent who referred 3 or more students (shown in the portal).
11. A low rating (≤ 2) opens a complaint automatically (instead of only a follow-up), tracked until closed.
12. Monthly complaints report: count by topic and branch, average time to resolve.

### Flow agreed (explained 2026-10-04)
- Stages: NEW → IN_PROGRESS → RESOLVED → CLOSED. The parent or student sees each stage and the staff reply in the portal,
  with a notification at each step.
- Every complaint has one responsible staff member and a reply deadline. Past the deadline it is escalated to the
  branch manager automatically.
- RESOLVED asks the sender "Was it solved?":
  - 👍 → CLOSED (plus a 1–5 rating of how it was handled);
  - 👎 → back to IN_PROGRESS and the manager is told.
- Open points, proposed defaults (configurable): reply deadline 24 h; auto-close 3 days after RESOLVED with no answer.

### Notes
- An old template `Complaint` table exists (title, description, PENDING/RESOLVED). Extend it additively or add new
  tables; no destructive schema change.
- The referral reward goes through the wallet engine (`lib/wallet/engine.ts`). The welcome discount is a DiscountType
  chosen on the Discounts page (like the birthday and early-renewal discounts).


## Implementation (2026-10-04)

### Schema (additive only)
- `Guardian.referralCode` (unique, nullable) and `AdmissionRequest.referralCode`.
- `ParentSurvey.recommend` (0–10).
- `Complaint`: new optional/defaulted columns:
  - `number` (TN-CMP-YYYY-NNNNN);
  - `kind`, `topic`, `body` (Text; the old `description` is VARCHAR 191, kept filled with the first 190 characters);
  - `studentId`, `classSectionId`, `campusId`, `source`, `assignedToId`;
  - `dueAt`, `firstReplyAt`, `escalatedAt`, `resolvedAt`, `closedAt`;
  - `satisfied`, `handlingRating`.
- New tables:
  - `ComplaintReply` (internal notes = staff only);
  - `Referral` (one per new student).
- Legacy status PENDING counts as NEW.

### Referrals (`lib/referrals/engine.ts`)
- `ensureReferralCode`: TN-REF-NAME + digits.
- `findReferrer`: by code (any case) or by phone.
- `linkReferral`: no self-referral, one per student; welcome DiscountAssignment if switched on; notifies the referrer.
- `rewardReferralIfDue`: called from `recordPayment` when an invoice becomes PAID. It locks PENDING → REWARDED, then adds a WalletTransaction of type REFERRAL to the referrer's oldest active child and runs autoPay.
- Settings in AppSetting `referral.settings` (default OFF): `rewardEnabled`, `rewardAmount`, `welcomeEnabled`, `welcomeTypeId`, `ambassadorAt` (3).
- Linked from:
  - the staff admission form (`referralCode` in the student schema);
  - the public application (approve links it);
  - the student page card.
- APIs:
  - `/api/referrals` (report; `?studentId=`; POST link);
  - `/api/referrals/settings`;
  - `/api/referrals/mine` (parent).
- UI:
  - `ParentReferralCard` (My Children; WhatsApp share; ambassador badge);
  - page `/dashboard/referrals`;
  - `StudentReferralCard`.
- RBAC `referrals`.
- NPS "recommend 0–10" in the LEVEL survey; an answer of 9–10 shows the referral card.

### Complaints (`lib/complaints/engine.ts`, `lib/complaints/access.ts`)
- `createComplaint` (portal / PHONE / AUTO_RATING), `addReply`, `updateComplaint` (stage, responsible person), `confirmResolution`.
- `sweepComplaints`:
  - escalates NEW complaints with no reply past `dueAt` to the branch managers;
  - auto-closes RESOLVED ones after `autoCloseDays`;
  - runs from the daily cron (forced) and from `/api/notifications/counts`, which staff browsers poll; throttled to once per 5 min per instance.
- `complaintsReport`. Settings in AppSetting `complaints.settings` (`replyHours` 24, `autoCloseDays` 3).
- APIs:
  - `/api/complaints` (role-aware: portal = own, staff = queue);
  - `/api/complaints/[id]` (GET thread, POST reply, PATCH stage/assignee);
  - `/api/complaints/[id]/confirm`;
  - `/api/complaints/report` (GET report, PUT settings).
- RBAC `complaints`:
  - update = handle (SA/Admin/Branch manager/Secretary);
  - create = record by phone;
  - export = report + settings.
- Page `/dashboard/complaints` rewritten:
  - senders: form + list;
  - staff: Queue / Record by phone / Report;
  - `ComplaintThread` shows the stage tracker, the conversation, the actions, and "solved?".
- A low rating now opens a complaint (source AUTO_RATING) instead of a plain follow-up.
- Staff with no branch on their profile count as "all branches" for staff notifications.
