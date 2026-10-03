/**
 * "Is your child continuing next month?" (phase A, docs/design-phase-a.md).
 *
 *  - when a group reaches N sessions before its last one (setting
 *    renewal.settings.sessionsBefore, default 2) every active student gets a
 *    RenewalRequest (once per group = once per cycle) and their parents a
 *    portal notification (also written to the contact log, channel SYSTEM)
 *  - parents answer in the portal, or staff record the answer (phone call)
 *  - "not continuing" asks why (PRICE | TIME | LEVEL | TRAVEL | OTHER) → churn report
 *  - early-renewal discount: if a discount type is set in Discounts → rules
 *    and the parent says YES before the last session, the student gets that
 *    discount (student-wide assignment, so it lands on next month's invoice)
 *  - Advance cycle pre-ticks YES / PENDING and unticks NO
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { getDiscountRules } from '@/lib/discounts/engine'
import { logSystemContact } from '@/lib/contacts/contact-log'
import { sessionsPerCycle } from './cycle-rules'
import { resolveCycleStart } from './cycle-start'

export interface RenewalSettings { sessionsBefore: number }
export const RENEWAL_DEFAULTS: RenewalSettings = { sessionsBefore: 2 }
export const getRenewalSettings = () => getSetting<RenewalSettings>('renewal.settings', RENEWAL_DEFAULTS)
export const saveRenewalSettings = (v: RenewalSettings, userId: string) => setSetting('renewal.settings', v, userId)

export const NOT_CONTINUING_REASONS = ['PRICE', 'TIME', 'LEVEL', 'TRAVEL', 'OTHER'] as const
export type NotContinuingReason = (typeof NOT_CONTINUING_REASONS)[number]

/** Sessions held in the group's current cycle and the cycle size. */
export async function cycleProgress(classSectionId: string) {
  const g = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { status: true, startDate: true, currentCycleStartDate: true, level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } } },
  })
  if (!g?.level) return null
  const per = sessionsPerCycle(g.level)
  const start = await resolveCycleStart(classSectionId, g.currentCycleStartDate, g.startDate)
  const held = start
    ? (await prisma.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: start } },
        select: { attendanceDate: true },
        distinct: ['attendanceDate'],
      })).length
    : 0
  return { per, held, remaining: Math.max(0, per - held), active: g.status === 'ACTIVE' }
}

/** Creates the requests when the group is close to its last session. Never throws. */
export async function ensureRenewalRequests(classSectionId: string): Promise<number> {
  try {
    const p = await cycleProgress(classSectionId)
    if (!p || !p.active || p.held === 0) return 0
    const { sessionsBefore } = await getRenewalSettings()
    if (p.remaining > Math.max(0, sessionsBefore)) return 0

    const [enrollments, existing, group] = await Promise.all([
      prisma.studentEnrollment.findMany({ where: { classSectionId, status: 'ACTIVE' }, select: { studentId: true } }),
      prisma.renewalRequest.findMany({ where: { classSectionId }, select: { studentId: true } }),
      prisma.classSection.findUnique({ where: { id: classSectionId }, select: { className: true, sectionName: true } }),
    ])
    const have = new Set(existing.map((e) => e.studentId))
    const todo = enrollments.map((e) => e.studentId).filter((id) => !have.has(id))
    if (!todo.length) return 0
    await prisma.renewalRequest.createMany({ data: todo.map((studentId) => ({ classSectionId, studentId })), skipDuplicates: true })

    const label = `${group?.className ?? ''} ${group?.sectionName ?? ''}`.trim()
    const students = await prisma.student.findMany({
      where: { id: { in: todo } },
      select: { id: true, firstName: true, guardians: { select: { id: true, userId: true } } },
    })
    const notes = students.flatMap((s) =>
      s.guardians.map((g) => ({
        userId: g.userId,
        title: 'Continuing next month?',
        message: `${s.firstName}'s month in ${label} ends soon. Please confirm if ${s.firstName} is continuing.`,
        type: 'RENEWAL_REQUEST',
        relatedId: s.id,
      }))
    )
    try {
      if (notes.length) await prisma.notification.createMany({ data: notes })
    } catch (err) {
      console.error('[RENEWAL_NOTIFY]', err)
    }
    for (const s of students) {
      await logSystemContact({
        studentId: s.id,
        guardianId: s.guardians[0]?.id ?? null,
        channel: 'SYSTEM',
        reason: 'RENEWAL',
        summary: `Renewal reminder sent in the parent portal (${label}).`,
      })
    }
    return todo.length
  } catch (err) {
    console.error('[RENEWAL_ENSURE]', err)
    return 0
  }
}

export type RespondOutcome =
  | { ok: true; status: string; earlyDiscount: boolean }
  | { ok: false; status: number; message: string }

export async function respondRenewal(input: {
  requestId: string
  answer: 'YES' | 'NO'
  reason?: NotContinuingReason | null
  note?: string | null
  via: 'PARENT' | 'STAFF'
  userId: string
}): Promise<RespondOutcome> {
  const r = await prisma.renewalRequest.findUnique({ where: { id: input.requestId } })
  if (!r) return { ok: false, status: 404, message: 'Request not found' }
  const group = await prisma.classSection.findUnique({ where: { id: r.classSectionId }, select: { status: true } })
  if (group?.status !== 'ACTIVE') return { ok: false, status: 409, message: 'This month is already closed' }
  if (input.answer === 'NO' && !input.reason) return { ok: false, status: 400, message: 'Choose why the student is not continuing' }

  let discountAssignmentId = r.discountAssignmentId
  let earlyDiscount = false
  if (input.answer === 'YES' && !discountAssignmentId) {
    const rules = await getDiscountRules()
    const p = await cycleProgress(r.classSectionId)
    // "Early" = before the cycle's last session has been held.
    if (rules.earlyRenewalTypeId && p && p.held < p.per) {
      const type = await prisma.discountType.findUnique({ where: { id: rules.earlyRenewalTypeId } })
      if (type?.isActive) {
        const a = await prisma.discountAssignment.create({
          data: {
            discountTypeId: type.id,
            studentId: r.studentId,
            value: type.value,
            status: 'ACTIVE',
            reason: 'Early renewal confirmation',
            requestedById: input.userId,
            approvedById: input.userId,
            approvedAt: new Date(),
          },
        })
        discountAssignmentId = a.id
        earlyDiscount = true
      }
    }
  }
  if (input.answer === 'NO' && discountAssignmentId) {
    // Changed their mind: take back an early-renewal discount that was not used yet.
    const a = await prisma.discountAssignment.findUnique({ where: { id: discountAssignmentId }, select: { timesUsed: true } })
    if (a && a.timesUsed === 0) {
      await prisma.discountAssignment.update({ where: { id: discountAssignmentId }, data: { status: 'ENDED', endedAt: new Date(), endedById: input.userId } })
      discountAssignmentId = null
    }
  }

  await prisma.renewalRequest.update({
    where: { id: r.id },
    data: {
      status: input.answer,
      reason: input.answer === 'NO' ? input.reason ?? 'OTHER' : null,
      reasonNote: input.note ?? null,
      respondedVia: input.via,
      respondedById: input.userId,
      respondedAt: new Date(),
      discountAssignmentId,
    },
  })
  return { ok: true, status: input.answer, earlyDiscount }
}
