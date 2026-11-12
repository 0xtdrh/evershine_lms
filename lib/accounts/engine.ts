/**
 * Six phases 1-A (2026-11-13): family accounts (server only).
 * - A family signs up on the website (createAccount) or staff make the account for an offline family (staffCreateAccount)
 *   and send it a link to choose its own password (newSetupLink / useSetupLink).
 * - The account adds its children (FamilyMember); a real Student is made at the first booking (batch B).
 * - Courses shown to each child follow its age; staff may open others (CourseUnlock).
 * The account is a normal Guardian + User (role GUARDIAN), so approving an admission with the same phone reuses it.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto'
import { hash } from '@node-rs/argon2'
import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { phoneVariants } from '@/lib/portal-login'
import { normalizePhone } from '@/lib/site/request-rules'
import { publicCatalog, type PublicCourse } from '@/lib/site/courses-store'
import { sendEmail } from '@/lib/email'
import {
  accountsSettingsSchema, ageOn, arrangeCourses, courseFit, DEFAULT_ACCOUNTS_SETTINGS, phoneLoginEmail,
  type AccountsSettings, type Fit, type MemberInput, type SignupAccountInput, type StaffAccountInput,
} from './rules'

const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4, outputLen: 32 }
const KEY = 'accounts.settings'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export async function getAccountsSettings(): Promise<AccountsSettings> {
  const raw = await getSetting<Partial<AccountsSettings>>(KEY, DEFAULT_ACCOUNTS_SETTINGS)
  return accountsSettingsSchema.parse({ ...DEFAULT_ACCOUNTS_SETTINGS, ...raw })
}
export async function saveAccountsSettings(userId: string, patch: Partial<AccountsSettings>) {
  const next = accountsSettingsSchema.parse({ ...(await getAccountsSettings()), ...patch })
  await setSetting(KEY, next, userId)
  return next
}

/** 010…, +2010…, 2010… → 010… (Egyptian mobiles); other international numbers stay as typed (+…). */
export function canonicalPhone(raw: string): string | null {
  const n = normalizePhone(raw)
  if (!n) return null
  const m = n.match(/^\+20(1[0125]\d{8})$/)
  return m ? `0${m[1]}` : n
}

/** The family account already using this phone (any way of writing it). */
export async function accountByPhone(phone: string) {
  return prisma.guardian.findFirst({ where: { phoneNumber: { in: phoneVariants(phone) } }, select: { id: true, userId: true, firstName: true, lastName: true, phoneNumber: true } })
}

export class AccountError extends Error {
  constructor(public code: 'ACCOUNT_EXISTS' | 'EMAIL_USED' | 'BAD_PHONE' | 'TOO_YOUNG' | 'NOT_FOUND' | 'LINK_BAD' | 'ENROLLED', message: string) { super(message) }
}

async function freeLoginEmail(email: string | null | undefined, phone: string) {
  const wanted = email?.trim().toLowerCase() || null
  if (wanted && (await prisma.user.findUnique({ where: { email: wanted }, select: { id: true } }))) throw new AccountError('EMAIL_USED', 'This e-mail already has an account · الإيميل ده عليه حساب قبل كده')
  return wanted ?? phoneLoginEmail(phone)
}

/** Website sign-up: the account is ready at once (the family signs in with its phone or e-mail and its password). */
export async function createAccount(v: SignupAccountInput) {
  const phone = canonicalPhone(v.phone)
  if (!phone) throw new AccountError('BAD_PHONE', 'Enter a valid mobile number · اكتب رقم موبايل صحيح')
  if (await accountByPhone(phone)) throw new AccountError('ACCOUNT_EXISTS', 'This number already has an account: sign in or reset the password · الرقم ده عليه حساب: ادخل أو غيّر الباسورد')
  if (v.who === 'SELF' && ageOn(v.dob!, cairoToday()) < 18) throw new AccountError('TOO_YOUNG', 'Signing up alone is from age 18; a parent makes the account · التسجيل لوحدك من سن 18، والأصغر ولي أمره يعمل الحساب')
  const loginEmail = await freeLoginEmail(v.email, phone)
  const passwordHash = await hash(v.password, ARGON2_OPTIONS)
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: loginEmail, passwordHash, role: 'GUARDIAN', isActive: true, displayName: `${v.firstName} ${v.lastName}`, profileSource: 'WEBSITE' } })
    const guardian = await tx.guardian.create({
      data: {
        userId: user.id, firstName: v.firstName, lastName: v.lastName, phoneNumber: phone, email: v.email || null,
        relationship: v.who === 'SELF' ? 'Self' : v.relationship || 'Guardian', signupSource: 'WEBSITE', selfAccount: v.who === 'SELF', country: v.country, city: v.city,
      },
    })
    if (v.who === 'SELF') {
      await tx.familyMember.create({ data: { guardianId: guardian.id, firstName: v.firstName, lastName: v.lastName, dateOfBirth: new Date(`${v.dob}T00:00:00Z`), gender: v.gender!, isSelf: true } })
    }
    return { guardianId: guardian.id, userId: user.id, phone }
  })
}

/** Staff make the account of a family that came to a branch; the family chooses its password from a link. */
export async function staffCreateAccount(staffId: string, v: StaffAccountInput) {
  const phone = canonicalPhone(v.phone)
  if (!phone) throw new AccountError('BAD_PHONE', 'Enter a valid mobile number · اكتب رقم موبايل صحيح')
  const old = await accountByPhone(phone)
  if (old) throw new AccountError('ACCOUNT_EXISTS', `This number already has an account (${old.firstName} ${old.lastName}) · الرقم ده عليه حساب`)
  const loginEmail = await freeLoginEmail(v.email, phone)
  // an unusable random password: nothing opens the account until the family uses the link
  const passwordHash = await hash(randomBytes(24).toString('hex'), ARGON2_OPTIONS)
  const guardian = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: loginEmail, passwordHash, role: 'GUARDIAN', isActive: true, displayName: `${v.firstName} ${v.lastName}`, profileSource: 'STAFF' } })
    const g = await tx.guardian.create({
      data: {
        userId: user.id, firstName: v.firstName, lastName: v.lastName, phoneNumber: phone, email: v.email || null,
        relationship: v.who === 'SELF' ? 'Self' : v.relationship || 'Guardian', signupSource: 'STAFF', selfAccount: v.who === 'SELF', country: v.country || 'Egypt', city: v.city || null,
      },
    })
    for (const m of v.members) await tx.familyMember.create({ data: memberData(g.id, m) })
    return g
  })
  const link = await newSetupLink(guardian.id, staffId)
  return { guardianId: guardian.id, ...link }
}

/** A one-time link to choose the password (also for old accounts made by an admission approval). Older links stop working. */
export async function newSetupLink(guardianId: string, staffId: string | null) {
  const s = await getAccountsSettings()
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + s.linkDays * 86_400_000)
  await prisma.$transaction([
    prisma.accountSetupLink.updateMany({ where: { guardianId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.accountSetupLink.create({ data: { guardianId, tokenHash: sha(token), expiresAt, createdById: staffId } }),
  ])
  return { token, path: `/account/setup/${token}`, expiresAt }
}

export async function setupLinkInfo(token: string) {
  const row = await prisma.accountSetupLink.findUnique({ where: { tokenHash: sha(token) } })
  if (!row || row.usedAt || row.expiresAt < new Date()) return null
  const g = await prisma.guardian.findUnique({ where: { id: row.guardianId }, select: { firstName: true, phoneNumber: true } })
  return g ? { firstName: g.firstName, phone: g.phoneNumber, expiresAt: row.expiresAt } : null
}

/** The family chooses its password; the link is used once; old sessions end. */
export async function useSetupLink(token: string, password: string) {
  const row = await prisma.accountSetupLink.findUnique({ where: { tokenHash: sha(token) } })
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AccountError('LINK_BAD', 'This link has expired or was used. Ask TechNova for a new one · اللينك ده انتهى أو اتستخدم. اطلب لينك جديد')
  const g = await prisma.guardian.findUnique({ where: { id: row.guardianId }, select: { userId: true, phoneNumber: true } })
  if (!g) throw new AccountError('NOT_FOUND', 'Account not found')
  const passwordHash = await hash(password, ARGON2_OPTIONS)
  await prisma.$transaction([
    prisma.user.update({ where: { id: g.userId }, data: { passwordHash, mustChangePassword: false, sessionsRevokedAt: new Date(), isActive: true } }),
    prisma.accountSetupLink.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])
  return { phone: g.phoneNumber }
}

// ── children ────────────────────────────────────────────────────────────────

function memberData(guardianId: string, m: MemberInput) {
  return {
    guardianId, firstName: m.firstName, lastName: m.lastName, dateOfBirth: new Date(`${m.dob}T00:00:00Z`), gender: m.gender,
    school: m.school || null, experience: m.experience || null,
  }
}
export const guardianOfUser = (userId: string) => prisma.guardian.findUnique({ where: { userId }, select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, country: true, city: true, selfAccount: true, signupSource: true } })

export async function addMember(guardianId: string, m: MemberInput) {
  if (ageOn(m.dob, cairoToday()) < 2 || ageOn(m.dob, cairoToday()) > 90) throw new AccountError('TOO_YOUNG', 'Check the date of birth · راجع تاريخ الميلاد')
  return prisma.familyMember.create({ data: memberData(guardianId, m) })
}
export async function updateMember(guardianId: string, id: string, m: MemberInput) {
  const row = await prisma.familyMember.findFirst({ where: { id, guardianId } })
  if (!row) throw new AccountError('NOT_FOUND', 'Not found')
  return prisma.familyMember.update({ where: { id }, data: memberData(guardianId, m) })
}
export async function removeMember(guardianId: string, id: string) {
  const row = await prisma.familyMember.findFirst({ where: { id, guardianId } })
  if (!row) throw new AccountError('NOT_FOUND', 'Not found')
  if (row.studentId) throw new AccountError('ENROLLED', 'Already registered: ask TechNova · متسجل بالفعل: كلّم TechNova')
  await prisma.familyMember.delete({ where: { id } })
}

/** Everyone in the family who can book: children not registered yet + registered students. */
export async function familyOf(guardianId: string) {
  const [members, students] = await Promise.all([
    prisma.familyMember.findMany({ where: { guardianId }, orderBy: { createdAt: 'asc' } }),
    prisma.student.findMany({ where: { guardians: { some: { id: guardianId } }, isActive: true }, select: { id: true, firstName: true, lastName: true, dateOfBirth: true, registrationNumber: true } }),
  ])
  const today = cairoToday()
  const studentIds = new Set(members.map((m) => m.studentId).filter(Boolean) as string[])
  return [
    ...members.filter((m) => !m.studentId).map((m) => ({ key: `m:${m.id}`, memberId: m.id, studentId: null as string | null, firstName: m.firstName, lastName: m.lastName, dob: m.dateOfBirth.toISOString().slice(0, 10), age: ageOn(m.dateOfBirth, today), gender: m.gender, school: m.school, experience: m.experience, isSelf: m.isSelf, registrationNumber: null as string | null })),
    ...students.map((s) => ({ key: `s:${s.id}`, memberId: members.find((m) => m.studentId === s.id)?.id ?? null, studentId: s.id, firstName: s.firstName, lastName: s.lastName, dob: s.dateOfBirth ? s.dateOfBirth.toISOString().slice(0, 10) : null, age: s.dateOfBirth ? ageOn(s.dateOfBirth, today) : null, gender: null as string | null, school: null as string | null, experience: null as string | null, isSelf: false, registrationNumber: s.registrationNumber })),
  ].filter((x, i, all) => !(x.studentId && studentIds.has(x.studentId) && all.findIndex((y) => y.studentId === x.studentId) !== i))
}
export type FamilyPerson = Awaited<ReturnType<typeof familyOf>>[number]

/** The course cards for one person of the family, with whether each suits it (age, opened by staff, already learning). */
export async function coursesFor(guardianId: string, person: FamilyPerson) {
  const [catalog, settings, unlocks, enrolled] = await Promise.all([
    publicCatalog(),
    getAccountsSettings(),
    prisma.courseUnlock.findMany({ where: { OR: [{ guardianId }, ...(person.memberId ? [{ memberId: person.memberId }] : []), ...(person.studentId ? [{ studentId: person.studentId }] : [])] }, select: { refType: true, refId: true } }),
    person.studentId
      ? prisma.studentEnrollment.findMany({ where: { studentId: person.studentId, status: 'ACTIVE' }, select: { classSection: { select: { level: { select: { subjectId: true } } } } } })
      : Promise.resolve([]),
  ])
  const enrolledCourseIds = enrolled.map((e) => e.classSection?.level?.subjectId).filter(Boolean) as string[]
  const rows = catalog.map((c: PublicCourse) => ({ ...c, fit: courseFit(c, person.age, unlocks, enrolledCourseIds) as Fit }))
  return { settings, courses: arrangeCourses(rows, settings.unsuitable) }
}

// ── staff: open a course for a family / a child ──────────────────────────────

export async function addUnlock(staffId: string, v: { guardianId?: string | null; memberId?: string | null; studentId?: string | null; refType: 'TRACK' | 'COURSE'; refId: string; note?: string | null }) {
  const exists = await prisma.courseUnlock.findFirst({ where: { guardianId: v.guardianId ?? null, memberId: v.memberId ?? null, studentId: v.studentId ?? null, refType: v.refType, refId: v.refId }, select: { id: true } })
  if (exists) return exists
  return prisma.courseUnlock.create({ data: { guardianId: v.guardianId ?? null, memberId: v.memberId ?? null, studentId: v.studentId ?? null, refType: v.refType, refId: v.refId, note: v.note || null, createdById: staffId } })
}

// ── e-mail check ─────────────────────────────────────────────────────────────

/** E-mails a 6-digit code in TechNova's name. False when sending is not ready (no key / domain yet). */
export async function sendEmailCode(userId: string, email: string) {
  const code = String(randomInt(100000, 1000000))
  await prisma.emailCheck.create({ data: { userId, email, codeHash: sha(`${userId}:${code}`), expiresAt: new Date(Date.now() + 15 * 60_000) } })
  return sendEmail({
    to: email, subject: 'TechNova — كود التأكيد / confirmation code',
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.8">كود تأكيد الإيميل بتاعك في TechNova:<br><b style="font-size:28px;letter-spacing:6px">${code}</b><br>الكود شغال 15 دقيقة. لو مش انت اللي طلبته تجاهل الرسالة.</div><hr><div style="font-family:Arial,sans-serif;font-size:14px">Your TechNova e-mail code: <b>${code}</b> (15 minutes).</div>`,
  })
}
export async function checkEmailCode(userId: string, code: string) {
  const row = await prisma.emailCheck.findFirst({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
  if (!row || row.attempts >= 5) return false
  if (row.codeHash !== sha(`${userId}:${code.trim()}`)) {
    await prisma.emailCheck.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    return false
  }
  await prisma.$transaction([
    prisma.emailCheck.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { emailVerified: true, emailVerifiedAt: new Date() } }),
    prisma.guardian.updateMany({ where: { userId }, data: { email: row.email } }),
  ])
  return true
}
