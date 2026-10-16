/**
 * 5-D targeted announcements (2026-10-17) — pure rules, no Prisma.
 * An announcement goes to AUDIENCES (parents / students / instructors / staff) inside one SCOPE (company, branches,
 * partners, tracks, courses, levels, groups or chosen students).
 * Who may send / who needs approval is NOT hard-coded: permission `announcements:create` sends, and a sender
 * without `announcements:approve` waits for approval — both set on the Permissions page (role, place or person).
 * Instructors may only send to their own groups (and only while the setting allows instructors to send).
 */

export const AUDIENCES = ['PARENT', 'STUDENT', 'TEACHER', 'STAFF'] as const
export type Audience = (typeof AUDIENCES)[number]

export const SCOPES = ['COMPANY', 'CAMPUS', 'PARTNER', 'TRACK', 'COURSE', 'LEVEL', 'GROUP', 'STUDENTS'] as const
export type ScopeType = (typeof SCOPES)[number]

export const AUDIENCE_LABEL: Record<Audience, [string, string]> = {
  PARENT: ['Parents', 'أولياء الأمور'],
  STUDENT: ['Students', 'الطلاب'],
  TEACHER: ['Instructors', 'المدربين'],
  STAFF: ['Staff', 'الموظفين'],
}

export const SCOPE_LABEL: Record<ScopeType, [string, string]> = {
  COMPANY: ['Whole company', 'الشركة كلها'],
  CAMPUS: ['Branches / places', 'فروع / أماكن'],
  PARTNER: ['Partners', 'شركاء'],
  TRACK: ['Tracks', 'تراكات'],
  COURSE: ['Courses', 'كورسات'],
  LEVEL: ['Levels', 'مستويات'],
  GROUP: ['Groups', 'جروبات'],
  STUDENTS: ['Chosen students', 'طلاب بالاسم'],
}

/** Staff are reached by place only (they are not in groups). */
export const STAFF_SCOPES: ScopeType[] = ['COMPANY', 'CAMPUS', 'PARTNER']

export interface AnnouncementSettings {
  /** instructors may send to their own groups */
  teachersCanSend: boolean
  /** new announcements ask "I read it" by default */
  defaultRequireAck: boolean
}
export const DEFAULT_ANNOUNCEMENT_SETTINGS: AnnouncementSettings = { teachersCanSend: true, defaultRequireAck: false }

export interface Draft {
  audiences: Audience[]
  scopeType: ScopeType
  scopeIds: string[]
}

/** What is wrong with this draft for this sender (null = fine). Place checks of the ids are done on the server. */
export function draftProblem(d: Draft, sender: { role: string; allPlaces: boolean; teachersCanSend: boolean }): string | null {
  if (!d.audiences.length) return 'Choose who receives it'
  if (d.scopeType !== 'COMPANY' && !d.scopeIds.length) return 'Choose at least one item'
  if (d.scopeType === 'COMPANY' && !sender.allPlaces) return 'Only someone with every place can send to the whole company'
  if (d.audiences.includes('STAFF') && !STAFF_SCOPES.includes(d.scopeType)) return 'Staff can be reached by company, branch or partner only'
  if (sender.role === 'TEACHER') {
    if (!sender.teachersCanSend) return 'Instructors cannot send announcements (setting)'
    if (d.scopeType !== 'GROUP') return 'Instructors can send to their own groups only'
    if (d.audiences.some((a) => a !== 'PARENT' && a !== 'STUDENT')) return 'Instructors can send to parents and students only'
  }
  return null
}

/** PENDING when the sender cannot approve, else PUBLISHED. */
export const statusFor = (canApprove: boolean) => (canApprove ? 'PUBLISHED' : 'PENDING')

export function reach(rows: { readAt: Date | string | null; ackAt: Date | string | null }[], requireAck: boolean) {
  const total = rows.length
  const read = rows.filter((r) => r.readAt).length
  const acked = rows.filter((r) => r.ackAt).length
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return { total, read, acked, readPct: pct(read), ackPct: requireAck ? pct(acked) : null }
}

/** Short copy for the old `content` column (VARCHAR 191). */
export const shortCopy = (s: string, n = 190) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const parseAudiences = (s: string | null | undefined): Audience[] =>
  (s ?? '').split(',').map((x) => x.trim()).filter((x): x is Audience => (AUDIENCES as readonly string[]).includes(x))
