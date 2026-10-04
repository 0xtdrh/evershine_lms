/**
 * Phase D referrals (docs/design-phase-d.md).
 *  - every parent has a referral code TN-REF-… (created the first time it is shown)
 *  - a new student is linked to the referrer by code or by the referrer's phone
 *    (staff admission form, public application, or the student page)
 *  - the new student can get a welcome discount (a DiscountType chosen in Referral settings, on/off)
 *  - when the new student's first invoice is PAID the referrer gets a wallet credit
 *    (on/off + amount in settings), put on one of the referrer's children, then the
 *    wallet pays that child's open invoices (autoPay)
 *  - "TechNova Ambassador" from N rewarded referrals (default 3)
 * Server-only.
 */

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { notifyUsers } from '@/lib/notifications/events'

export interface ReferralSettings {
  rewardEnabled: boolean
  rewardAmount: number
  welcomeEnabled: boolean
  welcomeTypeId: string | null
  ambassadorAt: number
}
export const REFERRAL_DEFAULTS: ReferralSettings = { rewardEnabled: false, rewardAmount: 100, welcomeEnabled: false, welcomeTypeId: null, ambassadorAt: 3 }
export const getReferralSettings = async (): Promise<ReferralSettings> => ({ ...REFERRAL_DEFAULTS, ...(await getSetting<Partial<ReferralSettings>>('referral.settings', {})) })
export const saveReferralSettings = (v: ReferralSettings, userId: string) => setSetting('referral.settings', v, userId)

const round2 = (n: number) => Math.round(n * 100) / 100
const codeName = (first: string) => (first.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6) || 'TN')

/** The parent's code, created on first use. */
export async function ensureReferralCode(guardianId: string): Promise<string | null> {
  const g = await prisma.guardian.findUnique({ where: { id: guardianId }, select: { referralCode: true, firstName: true } })
  if (!g) return null
  if (g.referralCode) return g.referralCode
  for (let i = 0; i < 6; i++) {
    const code = `TN-REF-${codeName(g.firstName)}${randomInt(10, i < 3 ? 99 : 9999)}`
    try {
      await prisma.guardian.update({ where: { id: guardianId }, data: { referralCode: code } })
      return code
    } catch (err) {
      if (!isUniqueConflictOn(err, 'referralCode')) throw err
    }
  }
  return null
}

const digits = (s: string) => s.replace(/\D/g, '')

/** Referrer by code (any case) or by the parent's phone number. */
export async function findReferrer(codeOrPhone: string) {
  const v = codeOrPhone.trim()
  if (!v) return null
  if (/^tn-ref-/i.test(v)) {
    return prisma.guardian.findFirst({ where: { referralCode: v.toUpperCase() }, select: { id: true, userId: true, firstName: true, lastName: true, referralCode: true } })
  }
  const d = digits(v)
  if (d.length < 8) return null
  const local = d.startsWith('20') && d.length === 12 ? `0${d.slice(2)}` : d
  return prisma.guardian.findFirst({ where: { phoneNumber: { in: [local, d, v] } }, select: { id: true, userId: true, firstName: true, lastName: true, referralCode: true } })
}

export interface ReferralOutcome { ok: boolean; code?: number; message?: string; referralId?: string; welcome?: boolean }

export async function linkReferral(input: { studentId: string; codeOrPhone: string; userId: string }): Promise<ReferralOutcome> {
  const referrer = await findReferrer(input.codeOrPhone)
  if (!referrer) return { ok: false, code: 404, message: 'No parent found with this referral code or phone number' }
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { id: true, firstName: true, lastName: true, guardians: { select: { id: true } } } })
  if (!student) return { ok: false, code: 404, message: 'Student not found' }
  if (student.guardians.some((g) => g.id === referrer.id)) return { ok: false, code: 409, message: 'A parent cannot refer their own child' }
  if (await prisma.referral.findUnique({ where: { referredStudentId: student.id } })) return { ok: false, code: 409, message: 'This student is already linked to a referral' }
  const code = referrer.referralCode ?? (await ensureReferralCode(referrer.id)) ?? ''

  const settings = await getReferralSettings()
  let welcomeAssignmentId: string | null = null
  if (settings.welcomeEnabled && settings.welcomeTypeId) {
    const type = await prisma.discountType.findUnique({ where: { id: settings.welcomeTypeId } })
    if (type?.isActive) {
      const a = await prisma.discountAssignment.create({
        data: { discountTypeId: type.id, studentId: student.id, value: type.value, status: 'ACTIVE', reason: `Referral welcome (${code})`, requestedById: input.userId, approvedById: input.userId, approvedAt: new Date() },
      })
      welcomeAssignmentId = a.id
    }
  }
  let ref
  try {
    ref = await prisma.referral.create({ data: { code, referrerGuardianId: referrer.id, referredStudentId: student.id, createdById: input.userId, welcomeAssignmentId } })
  } catch (err) {
    if (isUniqueConflictOn(err, 'referredStudentId')) return { ok: false, code: 409, message: 'This student is already linked to a referral' }
    throw err
  }
  await notifyUsers([referrer.userId], 'REFERRAL_UPDATE', {
    title: 'Your friend registered 🎉',
    message: `${student.firstName} joined TechNova with your referral code. ${settings.rewardEnabled && settings.rewardAmount > 0 ? `You get ${settings.rewardAmount} EGP in the wallet when the first invoice is paid.` : 'Thank you!'}`,
    relatedId: ref.id,
  })
  // Already paid before being linked (e.g. linked later from the student page)?
  await rewardReferralIfDue(student.id, input.userId)
  return { ok: true, referralId: ref.id, welcome: !!welcomeAssignmentId }
}

/** Called after every PAID invoice (recordPayment). Never throws. */
export async function rewardReferralIfDue(studentId: string, userId: string) {
  try {
    const ref = await prisma.referral.findUnique({ where: { referredStudentId: studentId } })
    if (!ref || ref.status !== 'PENDING') return
    const paid = await prisma.feeInvoice.count({ where: { studentId, status: 'PAID', totalAmount: { gt: 0 } } })
    if (!paid) return
    const settings = await getReferralSettings()
    const amount = settings.rewardEnabled ? round2(Math.max(0, settings.rewardAmount)) : 0
    const referrer = await prisma.guardian.findUnique({
      where: { id: ref.referrerGuardianId },
      select: { userId: true, students: { where: { isActive: true }, select: { id: true, firstName: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
    })
    const child = referrer?.students[0] ?? null
    // Lock: only one caller turns PENDING into REWARDED.
    const locked = await prisma.referral.updateMany({
      where: { id: ref.id, status: 'PENDING' },
      data: { status: 'REWARDED', rewardedAt: new Date(), rewardAmount: amount, rewardStudentId: amount > 0 ? child?.id ?? null : null },
    })
    if (!locked.count || amount <= 0 || !child) return
    const newcomer = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true } })
    await prisma.walletTransaction.create({
      data: { studentId: child.id, amount, type: 'REFERRAL', note: `Referral reward: ${newcomer?.firstName ?? 'a friend'} joined (${ref.code})`, createdById: userId },
    })
    await notifyUsers([referrer!.userId], 'REFERRAL_UPDATE', {
      title: `Referral reward: ${amount} EGP 🎁`,
      message: `${newcomer?.firstName ?? 'Your friend'} paid the first invoice — ${amount} EGP were added to ${child.firstName}'s wallet. Thank you for recommending TechNova!`,
      relatedId: ref.id,
    })
    const { autoPay } = await import('@/lib/wallet/engine')
    await autoPay(child.id, { userId })
  } catch (err) {
    console.error('[REFERRAL_REWARD]', err)
  }
}

/** Parent portal: code, the friends who joined, rewards, ambassador badge. */
export async function referralSummaryForGuardianUser(userId: string) {
  const g = await prisma.guardian.findUnique({ where: { userId }, select: { id: true } })
  if (!g) return null
  const [code, settings, refs] = await Promise.all([
    ensureReferralCode(g.id),
    getReferralSettings(),
    prisma.referral.findMany({ where: { referrerGuardianId: g.id }, orderBy: { createdAt: 'desc' } }),
  ])
  const students = await prisma.student.findMany({ where: { id: { in: refs.map((r) => r.referredStudentId) } }, select: { id: true, firstName: true } })
  const name = new Map(students.map((s) => [s.id, s.firstName]))
  const rewarded = refs.filter((r) => r.status === 'REWARDED').length
  return {
    code,
    rewardEnabled: settings.rewardEnabled && settings.rewardAmount > 0,
    rewardAmount: settings.rewardAmount,
    welcomeEnabled: settings.welcomeEnabled && !!settings.welcomeTypeId,
    ambassador: rewarded >= settings.ambassadorAt,
    ambassadorAt: settings.ambassadorAt,
    rewardedCount: rewarded,
    totalReward: round2(refs.reduce((a, r) => a + Number(r.rewardAmount ?? 0), 0)),
    friends: refs.map((r) => ({ id: r.id, name: name.get(r.referredStudentId) ?? '—', status: r.status, joinedAt: r.createdAt, reward: Number(r.rewardAmount ?? 0) })),
  }
}

/** Staff report: every referral + the top referrers. */
export async function referralReport(campusId?: string | null) {
  const refs = await prisma.referral.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })
  const [students, guardians] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: refs.map((r) => r.referredStudentId) } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true, campusId: true } }),
    prisma.guardian.findMany({ where: { id: { in: [...new Set(refs.map((r) => r.referrerGuardianId))] } }, select: { id: true, firstName: true, lastName: true, phoneNumber: true } }),
  ])
  const sMap = new Map(students.map((s) => [s.id, s]))
  const gMap = new Map(guardians.map((g) => [g.id, g]))
  const settings = await getReferralSettings()
  const rows = refs
    .filter((r) => !campusId || sMap.get(r.referredStudentId)?.campusId === campusId)
    .map((r) => {
      const s = sMap.get(r.referredStudentId)
      const g = gMap.get(r.referrerGuardianId)
      return {
        id: r.id, code: r.code, status: r.status, createdAt: r.createdAt, rewardedAt: r.rewardedAt, reward: Number(r.rewardAmount ?? 0),
        student: s ? { id: s.id, name: `${s.firstName} ${s.lastName}`, registrationNumber: s.registrationNumber } : null,
        referrer: g ? { id: g.id, name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber } : null,
      }
    })
  const byRef = new Map<string, { name: string; phone: string; count: number; rewarded: number; reward: number }>()
  for (const r of rows) {
    if (!r.referrer) continue
    const x = byRef.get(r.referrer.id) ?? { name: r.referrer.name, phone: r.referrer.phone, count: 0, rewarded: 0, reward: 0 }
    x.count++
    if (r.status === 'REWARDED') x.rewarded++
    x.reward = round2(x.reward + r.reward)
    byRef.set(r.referrer.id, x)
  }
  const top = [...byRef.entries()].map(([id, x]) => ({ id, ...x, ambassador: x.rewarded >= settings.ambassadorAt })).sort((a, b) => b.count - a.count).slice(0, 20)
  return {
    totals: { referrals: rows.length, rewarded: rows.filter((r) => r.status === 'REWARDED').length, pending: rows.filter((r) => r.status === 'PENDING').length, rewardPaid: round2(rows.reduce((a, r) => a + r.reward, 0)) },
    top,
    rows,
  }
}
