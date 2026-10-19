/**
 * 2026-10-19 ID cards — data for printing student / staff cards, replacing a lost card (new QR code, the old one stops
 * working), the print log, settings, and checking a scanned card. Places-limited for staff. Server-only.
 * Rules (pure) in lib/cards/rules.ts.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { loadPlaces, canSeeGroup, studentWhere, campusWhere } from '@/lib/places/server'
import { CARD_DEFAULTS, DEFAULT_TRACK_COLOR, cardState, firstStudentCode, isStaffCode, nextCode, normalizeCardCode, staffBaseCode, validUntil, type CardSettings, type CardState } from './rules'

type Who = { id: string; role: string }
export class CardError extends Error {}

const KEY = 'cards.settings'
export const getCardSettings = async (): Promise<CardSettings> => ({ ...CARD_DEFAULTS, ...(await getSetting<Partial<CardSettings>>(KEY, CARD_DEFAULTS)) })
export async function saveCardSettings(v: Partial<CardSettings>, userId: string) {
  const next = { ...(await getCardSettings()), ...v }
  next.validityMonths = Math.min(60, Math.max(1, Math.round(Number(next.validityMonths) || 12)))
  await setSetting(KEY, next, userId)
  return next
}

export interface CardData {
  kind: 'STUDENT' | 'STAFF'; id: string; code: string
  nameEn: string; nameAr: string | null; number: string; place: string; role: string | null
  track: string | null; color: string; photo: string | null; emergency: string | null
  issuedAt: string; validUntil: string
}

const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING', 'TEACHER'] as const

async function log(kind: 'STUDENT' | 'STAFF', subjectId: string, code: string, action: string, byUserId: string, reason?: string | null) {
  try { await prisma.idCardEvent.create({ data: { kind, subjectId, code, action, byUserId, reason: reason?.slice(0, 200) ?? null } }) } catch (e) { console.error('[ID_CARD_LOG]', e) }
}

/** Student cards for a group, a place or a list of students (only active students the person may see). */
export async function studentCards(user: Who, q: { groupId?: string | null; campusId?: string | null; studentIds?: string[] | null }): Promise<CardData[]> {
  const places = await loadPlaces(user)
  if (q.groupId && !(await canSeeGroup(user, q.groupId))) throw new CardError('This group is not in your places')
  if (q.campusId && !places.all && !places.campusIds.includes(q.campusId)) throw new CardError('This place is not yours')
  const where = {
    isActive: true, enrollmentStatus: 'ACTIVE' as const, ...studentWhere(places),
    ...(q.groupId ? { enrollments: { some: { classSectionId: q.groupId, status: 'ACTIVE' as const } } } : {}),
    ...(q.campusId ? { campusId: q.campusId } : {}),
    ...(q.studentIds?.length ? { id: { in: q.studentIds.slice(0, 500) } } : {}),
  }
  if (!q.groupId && !q.campusId && !q.studentIds?.length) throw new CardError('Choose a group, a place or students')
  const settings = await getCardSettings()
  const rows = await prisma.student.findMany({
    where, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: 500,
    select: {
      id: true, firstName: true, lastName: true, fullNameEn: true, fullNameAr: true, registrationNumber: true, profilePicture: true,
      emergencyContact: true, idCardQRCode: true, idCardIssueDate: true, idCardExpiryDate: true, admissionDate: true,
      campus: { select: { name: true } },
      enrollments: { where: { status: 'ACTIVE' }, take: 1, select: { classSection: { select: { level: { select: { subject: { select: { track: { select: { name: true, color: true } } } } } } } } } },
    },
  })
  const out: CardData[] = []
  for (const s of rows) {
    let code = s.idCardQRCode
    let issued = s.idCardIssueDate
    let expires = s.idCardExpiryDate
    if (!code || !issued || !expires) {
      // first card: make the code and the dates once
      code = code || firstStudentCode(s.registrationNumber)
      issued = issued || new Date()
      expires = expires || validUntil(issued, settings.validityMonths)
      await prisma.student.update({ where: { id: s.id }, data: { idCardQRCode: code, idCardIssueDate: issued, idCardExpiryDate: expires } })
      await log('STUDENT', s.id, code, 'ISSUED', user.id)
    }
    const track = s.enrollments[0]?.classSection.level?.subject.track ?? null
    out.push({
      kind: 'STUDENT', id: s.id, code, nameEn: s.fullNameEn || `${s.firstName} ${s.lastName}`.trim(), nameAr: s.fullNameAr ?? null,
      number: s.registrationNumber, place: s.campus?.name ?? '', role: null, track: track?.name ?? null, color: track?.color || DEFAULT_TRACK_COLOR,
      photo: s.profilePicture, emergency: settings.emergencyOnBack ? s.emergencyContact : null,
      issuedAt: issued.toISOString(), validUntil: expires.toISOString(),
    })
  }
  return out
}

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Management', ADMIN: 'Administration', BRANCH_MANAGER: 'Branch manager', SECRETARY: 'Front desk', ACCOUNTANT: 'Accounts', MARKETING: 'Marketing', TEACHER: 'Instructor' }

/** Staff cards for a place or a list of accounts. */
export async function staffCards(user: Who, q: { campusId?: string | null; userIds?: string[] | null }): Promise<CardData[]> {
  const places = await loadPlaces(user)
  if (q.campusId && !places.all && !places.campusIds.includes(q.campusId)) throw new CardError('This place is not yours')
  if (!q.campusId && !q.userIds?.length) throw new CardError('Choose a place or people')
  const settings = await getCardSettings()
  const placeFilter = q.campusId ? { campusId: q.campusId } : places.all ? {} : campusWhere(places)
  const profiles = { admin: placeFilter, branchManager: placeFilter, secretary: placeFilter, accountant: placeFilter, marketingStaff: placeFilter, teacher: placeFilter }
  const users = await prisma.user.findMany({
    where: {
      isActive: true, role: { in: [...STAFF_ROLES] },
      ...(q.userIds?.length ? { id: { in: q.userIds.slice(0, 500) } } : {}),
      OR: Object.entries(profiles).map(([k, v]) => ({ [k]: v })),
    },
    take: 500, orderBy: { displayName: 'asc' },
    select: {
      id: true, role: true, displayName: true, email: true, cardCode: true, cardIssuedAt: true,
      teacher: { select: { firstName: true, lastName: true, employeeId: true, profilePicture: true, phoneNumber: true, campus: { select: { name: true } } } },
      admin: { select: { firstName: true, lastName: true, campus: { select: { name: true } } } },
      branchManager: { select: { firstName: true, lastName: true, campus: { select: { name: true } } } },
      secretary: { select: { firstName: true, lastName: true, campus: { select: { name: true } } } },
      accountant: { select: { firstName: true, lastName: true, employeeId: true, campus: { select: { name: true } } } },
      marketingStaff: { select: { firstName: true, lastName: true, campus: { select: { name: true } } } },
    },
  })
  const out: CardData[] = []
  for (const u of users) {
    const p = u.teacher ?? u.admin ?? u.branchManager ?? u.secretary ?? u.accountant ?? u.marketingStaff
    const number = u.teacher?.employeeId ?? u.accountant?.employeeId ?? u.id.slice(-8).toUpperCase()
    let code = u.cardCode
    let issued = u.cardIssuedAt
    if (!code || !issued) {
      code = code || staffBaseCode(number)
      issued = issued || new Date()
      await prisma.user.update({ where: { id: u.id }, data: { cardCode: code, cardIssuedAt: issued } })
      await log('STAFF', u.id, code, 'ISSUED', user.id)
    }
    out.push({
      kind: 'STAFF', id: u.id, code, nameEn: p ? `${p.firstName} ${p.lastName}`.trim() : u.displayName || u.email, nameAr: null, number,
      place: p?.campus?.name ?? '', role: ROLE_LABEL[u.role] ?? u.role, track: null, color: DEFAULT_TRACK_COLOR,
      photo: u.teacher?.profilePicture ?? null, emergency: null,
      issuedAt: issued.toISOString(), validUntil: validUntil(issued, settings.validityMonths).toISOString(),
    })
  }
  return out
}

/** A lost card: a new code (the old card stops working everywhere), new dates, optional replacement fee. */
export async function replaceCard(user: Who, kind: 'STUDENT' | 'STAFF', id: string, opts: { reason?: string | null; chargeFee?: boolean }) {
  const settings = await getCardSettings()
  const now = new Date()
  if (kind === 'STUDENT') {
    const places = await loadPlaces(user)
    const s = await prisma.student.findFirst({ where: { id, ...studentWhere(places) }, select: { id: true, registrationNumber: true, idCardQRCode: true } })
    if (!s) throw new CardError('Student not found in your places')
    const code = nextCode(s.idCardQRCode, firstStudentCode(s.registrationNumber))
    await prisma.student.update({ where: { id }, data: { idCardQRCode: code, idCardIssueDate: now, idCardExpiryDate: validUntil(now, settings.validityMonths) } })
    await log('STUDENT', id, code, 'REPLACED', user.id, opts.reason)
    let fee = false
    if (opts.chargeFee && settings.replacementFeeTypeId) {
      await (await import('@/lib/fees-extra/engine')).addFee(user, id, settings.replacementFeeTypeId)
      fee = true
    }
    return { code, fee }
  }
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, cardCode: true, teacher: { select: { employeeId: true } }, accountant: { select: { employeeId: true } } } })
  if (!u) throw new CardError('Account not found')
  const base = staffBaseCode(u.teacher?.employeeId ?? u.accountant?.employeeId ?? u.id.slice(-8).toUpperCase())
  const code = nextCode(u.cardCode, base)
  await prisma.user.update({ where: { id }, data: { cardCode: code, cardIssuedAt: now } })
  await log('STAFF', id, code, 'REPLACED', user.id, opts.reason)
  return { code, fee: false }
}

export async function logPrinted(user: Who, cards: { kind: 'STUDENT' | 'STAFF'; id: string; code: string }[]) {
  for (const c of cards.slice(0, 500)) await log(c.kind, c.id, c.code, 'PRINTED', user.id)
  return { logged: Math.min(cards.length, 500) }
}

export async function cardHistory(kind: 'STUDENT' | 'STAFF', subjectId: string) {
  return prisma.idCardEvent.findMany({ where: { kind, subjectId }, orderBy: { createdAt: 'desc' }, take: 50 })
}

/**
 * A scanned card. Anyone: only valid / not valid. Signed-in staff who may see the person: who it is too.
 */
export async function checkCard(scanned: string, viewer: Who | null): Promise<{ state: CardState; kind: 'STUDENT' | 'STAFF' | null; validUntil: string | null; person?: { name: string; number: string; place: string; photo: string | null; href: string } }> {
  const code = normalizeCardCode(scanned)
  const settings = await getCardSettings()
  const now = new Date()
  if (isStaffCode(code)) {
    const u = await prisma.user.findFirst({ where: { cardCode: code }, select: { id: true, isActive: true, cardIssuedAt: true, displayName: true, email: true, role: true } })
    const until = u?.cardIssuedAt ? validUntil(u.cardIssuedAt, settings.validityMonths) : null
    const state = cardState({ found: !!u, active: !!u?.isActive, expiresAt: until, now })
    const staffViewer = viewer && !['STUDENT', 'PARENT', 'GUARDIAN'].includes(viewer.role)
    return { state, kind: u ? 'STAFF' : null, validUntil: until?.toISOString() ?? null, ...(u && staffViewer ? { person: { name: u.displayName || u.email, number: u.role, place: '', photo: null, href: '/dashboard/teachers' } } : {}) }
  }
  const s = await prisma.student.findFirst({
    where: { idCardQRCode: code },
    select: { id: true, isActive: true, enrollmentStatus: true, idCardExpiryDate: true, firstName: true, lastName: true, registrationNumber: true, profilePicture: true, campus: { select: { name: true } } },
  })
  const state = cardState({ found: !!s, active: !!s && s.isActive && s.enrollmentStatus === 'ACTIVE', expiresAt: s?.idCardExpiryDate ?? null, now })
  let person
  if (s && viewer && !['STUDENT', 'PARENT', 'GUARDIAN'].includes(viewer.role)) {
    const { canSeeStudent } = await import('@/lib/places/server')
    if (viewer.role === 'TEACHER' || (await canSeeStudent(viewer, s.id))) person = { name: `${s.firstName} ${s.lastName}`.trim(), number: s.registrationNumber, place: s.campus?.name ?? '', photo: s.profilePicture, href: `/dashboard/students/${s.id}` }
  }
  return { state, kind: s ? 'STUDENT' : null, validUntil: s?.idCardExpiryDate?.toISOString() ?? null, ...(person ? { person } : {}) }
}

/** The digital card of a student for the portal (parent of the child, or the student), when the setting allows it. */
export async function portalCard(viewer: Who, studentId: string): Promise<CardData | null> {
  const settings = await getCardSettings()
  if (viewer.role === 'STUDENT' && !settings.digitalForStudents) return null
  if ((viewer.role === 'PARENT' || viewer.role === 'GUARDIAN') && !settings.digitalForParents) return null
  const sys = { id: viewer.id, role: 'SUPER_ADMIN' }
  const list = await studentCards(sys, { studentIds: [studentId] })
  return list[0] ?? null
}
