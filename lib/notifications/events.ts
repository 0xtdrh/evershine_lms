/**
 * Phase C: one catalog of the notifications TechNova sends, one switch per
 * event (Settings → Notifications, AppSetting `notifications.events`) and one
 * way to send them (docs/design-phase-c.md).
 *
 * Parents can NOT switch notifications off (owner, 2026-10-03); only staff
 * with `notification_settings:update` turn an event type on/off for everyone.
 * Every send is an in-app notification; when the WhatsApp Cloud API is
 * configured (lib/messaging/whatsapp.ts) parent events also go to WhatsApp.
 * Never throws: a notification must never break the main action.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { isAutoWhatsAppConfigured, sendWhatsAppText } from '@/lib/messaging/whatsapp'
import { checkPermission } from '@/lib/rbac'

export type Audience = 'PARENT' | 'STAFF'
export interface EventDef { key: string; label: string; description: string; audience: Audience }

export const NOTIFICATION_EVENTS = [
  { key: 'ATTENDANCE_ABSENT', label: 'Student absent', description: 'Parent: your child was absent from a session', audience: 'PARENT' },
  { key: 'ATTENDANCE_LATE', label: 'Student late', description: 'Parent: your child arrived late', audience: 'PARENT' },
  { key: 'EXCUSE_DECIDED', label: 'Excuse accepted / refused', description: 'Parent: the absence excuse was accepted or refused', audience: 'PARENT' },
  { key: 'INVOICE_NEW', label: 'New invoice', description: 'Parent: a new invoice was issued', audience: 'PARENT' },
  { key: 'SESSION_CANCELLED', label: 'Session cancelled', description: 'Parent: a session was cancelled', audience: 'PARENT' },
  { key: 'SESSION_SUBSTITUTE', label: 'Substitute instructor', description: 'Parent: another instructor will give a session', audience: 'PARENT' },
  { key: 'HOLIDAY', label: 'Day off', description: 'Parent: a holiday postpones a session', audience: 'PARENT' },
  { key: 'RESULT_PUBLISHED', label: 'Result ready', description: 'Parent and student: the level result is ready', audience: 'PARENT' },
  { key: 'CERTIFICATE_ISSUED', label: 'Certificate ready', description: 'Parent and student: a certificate was revealed', audience: 'PARENT' },
  { key: 'REPORT_READY', label: 'Report ready', description: 'Parent: the monthly / level report is ready', audience: 'PARENT' },
  { key: 'PERFECT_ATTENDANCE', label: 'Perfect attendance', description: 'Parent and student: no absence in the whole month', audience: 'PARENT' },
  { key: 'FEEDBACK_REQUEST', label: 'Rate the month', description: 'Parent: please rate the sessions, the instructor and TechNova', audience: 'PARENT' },
  { key: 'WALLET_PAYMENT', label: 'Paid from the wallet', description: 'Parent: an invoice was paid automatically from the wallet (with the receipt)', audience: 'PARENT' },
  { key: 'LOW_BALANCE', label: 'Wallet balance low', description: 'Parent: the wallet is below the next month price', audience: 'PARENT' },
  { key: 'RENEWAL_REQUEST', label: 'Continuing next month?', description: 'Parent: please confirm if your child continues (renewals)', audience: 'PARENT' },
  { key: 'BIRTHDAY', label: 'Birthday greeting', description: 'Student, parent or staff member: happy birthday', audience: 'PARENT' },
  { key: 'EXCUSE_PENDING', label: 'Excuse to review', description: 'Staff: a parent sent an excuse that needs approval', audience: 'STAFF' },
  { key: 'CONSECUTIVE_ABSENCE', label: 'Absent twice in a row', description: 'Staff: a student missed two sessions in a row (a follow-up is added)', audience: 'STAFF' },
  { key: 'LOW_RATING', label: 'Low rating', description: 'Managers: a rating of 2 or less (a follow-up is added)', audience: 'STAFF' },
  { key: 'BIRTHDAY_STAFF', label: 'Birthdays today (staff)', description: 'Instructors and branch staff: whose birthday is today', audience: 'STAFF' },
  { key: 'COMPLAINT_UPDATE', label: 'Complaint update', description: 'Parent / student: a reply or a new stage on their complaint', audience: 'PARENT' },
  { key: 'REFERRAL_UPDATE', label: 'Referral', description: 'Parent: a friend registered with your code / you earned a referral reward', audience: 'PARENT' },
  { key: 'ASSIGNMENT_NEW', label: 'New homework', description: 'Parent and student: a new assignment is open (with its due date)', audience: 'PARENT' },
  { key: 'ASSIGNMENT_DUE', label: 'Homework due soon', description: 'Parent and student: due within a day and not handed in yet', audience: 'PARENT' },
  { key: 'ASSIGNMENT_GRADED', label: 'Homework graded', description: 'Parent and student: the grade / feedback is ready, or changes were asked', audience: 'PARENT' },
  { key: 'ASSIGNMENT_UNGRADED', label: 'Homework waiting to be graded', description: 'Instructor: hand-ins waiting more than 48 hours', audience: 'STAFF' },
  { key: 'COMPLAINT_NEW', label: 'New complaint', description: 'Complaint handlers: a new complaint, suggestion or praise', audience: 'STAFF' },
  { key: 'COMPLAINT_ESCALATED', label: 'Complaint escalated', description: 'Managers: no reply before the deadline, or the sender says it is not solved', audience: 'STAFF' },
  { key: 'CURRICULUM_REVIEW', label: 'Curriculum to review', description: 'Approvers: a curriculum version was sent for review', audience: 'STAFF' },
  { key: 'MORNING_SUMMARY', label: 'Morning summary', description: 'Managers: today\'s sessions, missing attendance, overdue invoices, items waiting', audience: 'STAFF' },
] as const satisfies readonly EventDef[]

export type EventKey = (typeof NOTIFICATION_EVENTS)[number]['key']
export type EventSwitches = Partial<Record<EventKey, boolean>>

const KEY = 'notifications.events'
export const getEventSwitches = () => getSetting<EventSwitches>(KEY, {})
export async function saveEventSwitches(v: EventSwitches, userId: string) {
  const known = new Set<string>(NOTIFICATION_EVENTS.map((e) => e.key))
  const clean: EventSwitches = {}
  for (const [k, on] of Object.entries(v)) if (known.has(k)) clean[k as EventKey] = !!on
  await setSetting(KEY, clean, userId)
  return clean
}
/** Every event is ON unless switched off. */
export async function isEventOn(key: EventKey): Promise<boolean> {
  try {
    const s = await getEventSwitches()
    return s[key] !== false
  } catch {
    return true
  }
}

export interface NotifyContent { title: string; message: string; relatedId?: string | null }

/** Notification.title / message are VARCHAR(191): keep texts inside that (the full text still goes to WhatsApp). */
const clip = (s: string, n = 190) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** In-app notification to these users (deduplicated). */
export async function notifyUsers(userIds: (string | null | undefined)[], key: EventKey, c: NotifyContent): Promise<number> {
  try {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))]
    if (!ids.length || !(await isEventOn(key))) return 0
    await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, title: clip(c.title), message: clip(c.message), type: key, relatedId: c.relatedId ?? null })) })
    return ids.length
  } catch (err) {
    console.error('[NOTIFY_USERS]', key, err)
    return 0
  }
}

/**
 * Parents (and optionally the student) of these students. One message per
 * student (the text may mention the student). WhatsApp too when configured.
 */
export async function notifyFamilies(
  studentIds: string[],
  key: EventKey,
  build: (s: { id: string; firstName: string; lastName: string }) => NotifyContent | null,
  opts: { includeStudent?: boolean } = {}
): Promise<number> {
  try {
    const ids = [...new Set(studentIds.filter(Boolean))]
    if (!ids.length || !(await isEventOn(key))) return 0
    const students = await prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, userId: true, guardians: { select: { userId: true, phoneNumber: true, isActive: true } } },
    })
    const rows: { userId: string; title: string; message: string; type: string; relatedId: string | null }[] = []
    const whatsapp: { phone: string; text: string }[] = []
    for (const s of students) {
      const c = build(s)
      if (!c) continue
      const users = new Set<string>()
      for (const g of s.guardians) if (g.isActive !== false) { users.add(g.userId); if (g.phoneNumber) whatsapp.push({ phone: g.phoneNumber, text: `${c.title}\n${c.message}` }) }
      if (opts.includeStudent && s.userId) users.add(s.userId)
      for (const userId of users) rows.push({ userId, title: clip(c.title), message: clip(c.message), type: key, relatedId: c.relatedId ?? null })
    }
    if (rows.length) await prisma.notification.createMany({ data: rows })
    if (whatsapp.length && isAutoWhatsAppConfigured()) {
      for (const w of whatsapp) await sendWhatsAppText(w.phone, w.text)
    }
    return rows.length
  } catch (err) {
    console.error('[NOTIFY_FAMILIES]', key, err)
    return 0
  }
}

const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] as const
const ALL_STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING'] as const

/** Staff (of that branch) whose role has this permission — e.g. complaint handlers. */
export async function usersWithPermission(resource: Parameters<typeof checkPermission>[1], action: Parameters<typeof checkPermission>[2], campusId?: string | null): Promise<string[]> {
  const roles = ALL_STAFF_ROLES.filter((r) => checkPermission(r, resource, action))
  return roles.length ? staffUserIds([...roles], campusId) : []
}
const BRANCH_STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] as const

/** Staff users who manage a branch: Super Admin / Admin everywhere, branch managers of that branch. */
export async function managerUserIds(campusId?: string | null): Promise<string[]> {
  return staffUserIds([...MANAGER_ROLES], campusId)
}
/** Front-desk staff of a branch (managers + secretaries of that branch). */
export async function branchStaffUserIds(campusId?: string | null): Promise<string[]> {
  return staffUserIds([...BRANCH_STAFF_ROLES], campusId)
}

async function staffUserIds(roles: string[], campusId?: string | null): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: roles as never } },
    select: { id: true, role: true, admin: { select: { campusId: true } }, secretary: { select: { campusId: true } }, branchManager: { select: { campusId: true } } },
  })
  return users
    .filter((u) => {
      if (u.role === 'SUPER_ADMIN' || !campusId) return true
      const own = u.admin?.campusId ?? u.branchManager?.campusId ?? u.secretary?.campusId ?? null
      // No branch on the profile = works for all branches (same as campusScope).
      return !own || own === campusId
    })
    .map((u) => u.id)
}
