/**
 * Discounts on group invoices (database side). Server-only.
 * Maths: lib/discounts/calculate.ts. Design: docs/design-discounts.md.
 *
 * Which discounts a student gets on an invoice for a group:
 *  1. ACTIVE assignments: for this student (everywhere, in this group, or in
 *     this group's track) or for the whole group
 *  2. automatic types (autoApply): siblings (rule from settings) and promos
 *     whose scope matches the group
 * A type must be active and inside its validity dates. Duration:
 *  EVERY_CYCLE every invoice; FIRST_CYCLE only the student's first month in
 *  that course; ONE_TIME once per student.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { computeDiscounts, type DiscountCandidate, type DiscountResult, type DiscountValueType } from './calculate'

type Db = Prisma.TransactionClient | typeof prisma

// ── settings ────────────────────────────────────────────────────────────────
export interface DiscountRulesSettings {
  /** More than one discount on the same invoice. */
  allowStacking: boolean
  /** Cap on the total, % of the price; null = no cap. */
  maxTotalPercent: number | null
  /** Sibling discount: every child except the first registered, or all of them. */
  siblingAppliesTo: 'SECOND_AND_LATER' | 'ALL'
  /** Phase A: discount type given for confirming "continuing" before the last session (null = off). */
  earlyRenewalTypeId: string | null
  /** Phase C: discount type given on the student's birthday (null = off) */
  birthdayTypeId: string | null
}
export const DISCOUNT_RULE_DEFAULTS: DiscountRulesSettings = {
  allowStacking: true,
  maxTotalPercent: 50,
  siblingAppliesTo: 'SECOND_AND_LATER',
  earlyRenewalTypeId: null,
  birthdayTypeId: null,
}
export const getDiscountRules = () => getSetting<DiscountRulesSettings>('discounts.rules', DISCOUNT_RULE_DEFAULTS)
export const saveDiscountRules = (v: DiscountRulesSettings, userId: string) => setSetting('discounts.rules', v, userId)

// ── context ─────────────────────────────────────────────────────────────────
export interface GroupContext { classSectionId: string; levelId: string | null; subjectId: string | null; trackId: string | null }

export async function groupContext(db: Db, classSectionId: string): Promise<GroupContext> {
  const g = await db.classSection.findUnique({
    where: { id: classSectionId },
    select: { levelId: true, level: { select: { subjectId: true, subject: { select: { trackId: true } } } } },
  })
  return {
    classSectionId,
    levelId: g?.levelId ?? null,
    subjectId: g?.level?.subjectId ?? null,
    trackId: g?.level?.subject?.trackId ?? null,
  }
}

interface TypeLike {
  id: string; name: string; kind: string; valueType: string; value: Prisma.Decimal | number
  duration: string; autoApply: boolean; scopeType: string; scopeId: string | null
  validFrom: Date | null; validTo: Date | null; stackable: boolean; isActive: boolean
}

export function typeMatchesScope(t: Pick<TypeLike, 'scopeType' | 'scopeId'>, ctx: GroupContext): boolean {
  switch (t.scopeType) {
    case 'TRACK': return !!t.scopeId && t.scopeId === ctx.trackId
    case 'COURSE': return !!t.scopeId && t.scopeId === ctx.subjectId
    case 'LEVEL': return !!t.scopeId && t.scopeId === ctx.levelId
    case 'GROUP': return !!t.scopeId && t.scopeId === ctx.classSectionId
    default: return true
  }
}

export function typeIsValidNow(t: Pick<TypeLike, 'isActive' | 'validFrom' | 'validTo'>, now = new Date()): boolean {
  if (!t.isActive) return false
  if (t.validFrom && now < t.validFrom) return false
  if (t.validTo && now > endOfDay(t.validTo)) return false
  return true
}
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999))

// ── duration helpers ────────────────────────────────────────────────────────
/** True if the student has no other (non-cancelled) invoice in this course. */
async function isFirstMonthInCourse(db: Db, studentId: string, ctx: GroupContext, excludeInvoiceId?: string) {
  if (!ctx.subjectId) return true
  const n = await db.feeInvoice.count({
    where: {
      studentId,
      status: { not: 'CANCELLED' },
      level: { subjectId: ctx.subjectId },
      ...(excludeInvoiceId && { id: { not: excludeInvoiceId } }),
    },
  })
  return n === 0
}

async function usedBefore(db: Db, studentId: string, by: { assignmentId?: string; discountTypeId?: string }, excludeInvoiceId?: string) {
  const n = await db.invoiceDiscount.count({
    where: { studentId, ...by, ...(excludeInvoiceId && { invoiceId: { not: excludeInvoiceId } }) },
  })
  return n > 0
}

async function durationAllows(
  db: Db,
  duration: string,
  studentId: string,
  ctx: GroupContext,
  by: { assignmentId?: string; discountTypeId?: string },
  excludeInvoiceId?: string
) {
  if (duration === 'FIRST_CYCLE') return isFirstMonthInCourse(db, studentId, ctx, excludeInvoiceId)
  if (duration === 'ONE_TIME') return !(await usedBefore(db, studentId, by, excludeInvoiceId))
  return true
}

// ── siblings ────────────────────────────────────────────────────────────────
/**
 * Siblings = students sharing a parent (Guardian) who are both currently in an
 * active group. SECOND_AND_LATER: everyone except the first registered child.
 */
export async function siblingDiscountApplies(db: Db, studentId: string, appliesTo: DiscountRulesSettings['siblingAppliesTo']) {
  const me = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, createdAt: true, guardians: { select: { students: { select: { id: true, createdAt: true, isActive: true } } } } },
  })
  if (!me) return false
  const others = new Map<string, Date>()
  for (const g of me.guardians) for (const s of g.students) if (s.id !== me.id && s.isActive) others.set(s.id, s.createdAt)
  if (others.size === 0) return false
  const activeIds = (
    await db.studentEnrollment.findMany({
      where: { studentId: { in: [...others.keys()] }, status: 'ACTIVE', classSection: { status: 'ACTIVE' } },
      select: { studentId: true },
    })
  ).map((e) => e.studentId)
  const activeSiblings = [...new Set(activeIds)]
  if (activeSiblings.length === 0) return false
  if (appliesTo === 'ALL') return true
  const family = [{ id: me.id, at: me.createdAt }, ...activeSiblings.map((id) => ({ id, at: others.get(id)! }))]
  family.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
  return family[0].id !== me.id
}

// ── candidates ──────────────────────────────────────────────────────────────
const toCandidate = (t: TypeLike, value: number, assignmentId: string | null, label?: string): DiscountCandidate => ({
  discountTypeId: t.id,
  assignmentId,
  label: label ?? t.name,
  valueType: (t.valueType === 'FIXED' ? 'FIXED' : 'PERCENT') as DiscountValueType,
  value,
  stackable: t.stackable,
})

export async function gatherCandidates(
  db: Db,
  studentId: string,
  ctx: GroupContext,
  opts: { excludeInvoiceId?: string; now?: Date; rules?: DiscountRulesSettings } = {}
): Promise<DiscountCandidate[]> {
  const now = opts.now ?? new Date()
  const rules = opts.rules ?? (await getDiscountRules())
  const out: DiscountCandidate[] = []

  // 1. assignments
  const assignments = await db.discountAssignment.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { studentId, classSectionId: null, trackId: null },
        { studentId, classSectionId: ctx.classSectionId },
        ...(ctx.trackId ? [{ studentId, trackId: ctx.trackId }] : []),
        { studentId: null, classSectionId: ctx.classSectionId },
      ],
    },
    include: { discountType: true },
    orderBy: { createdAt: 'asc' },
  })
  const seenTypes = new Set<string>()
  for (const a of assignments) {
    const t = a.discountType
    if (!typeIsValidNow(t, now) || !typeMatchesScope(t, ctx)) continue
    if (!(await durationAllows(db, t.duration, studentId, ctx, { assignmentId: a.id }, opts.excludeInvoiceId))) continue
    out.push(toCandidate(t, Number(a.value), a.id))
    seenTypes.add(t.id)
  }

  // 2. automatic types (a type already given by an assignment is not added twice)
  const autoTypes = await db.discountType.findMany({ where: { autoApply: true, isActive: true } })
  for (const t of autoTypes) {
    if (seenTypes.has(t.id) || !typeIsValidNow(t, now) || !typeMatchesScope(t, ctx)) continue
    if (t.kind === 'SIBLING' && !(await siblingDiscountApplies(db, studentId, rules.siblingAppliesTo))) continue
    if (!(await durationAllows(db, t.duration, studentId, ctx, { discountTypeId: t.id }, opts.excludeInvoiceId))) continue
    out.push(toCandidate(t, Number(t.value), null))
  }
  return out
}

/** Discounts for one invoice of `base` EGP. */
export async function computeForInvoice(
  db: Db,
  studentId: string,
  classSectionId: string,
  base: number,
  opts: { excludeInvoiceId?: string; now?: Date } = {}
): Promise<DiscountResult> {
  const [ctx, rules] = await Promise.all([groupContext(db, classSectionId), getDiscountRules()])
  const candidates = await gatherCandidates(db, studentId, ctx, { ...opts, rules })
  return computeDiscounts(base, candidates, rules)
}

/** Records the applied lines (InvoiceDiscount) and counts assignment usage. */
export async function recordInvoiceDiscounts(db: Db, invoiceId: string, studentId: string, result: DiscountResult, appliedById?: string) {
  for (const l of result.lines) {
    await db.invoiceDiscount.create({
      data: {
        invoiceId,
        studentId,
        discountTypeId: l.discountTypeId,
        assignmentId: l.assignmentId ?? null,
        label: l.label,
        amount: l.amount,
        appliedById: appliedById ?? null,
      },
    })
    if (l.assignmentId) {
      await db.discountAssignment.update({ where: { id: l.assignmentId }, data: { timesUsed: { increment: 1 } } })
    }
  }
}

export type ReapplyOutcome =
  | { ok: true; discount: number; totalAmount: number; status: string }
  | { ok: false; reason: string }

/**
 * Re-computes the discounts of an existing, not fully paid group invoice
 * (used when a new discount is given and staff choose "apply to the current
 * invoice too"). Refused if the student already paid more than the new total
 * (that needs a refund, not a discount).
 */
export async function reapplyDiscountsToInvoice(invoiceId: string, actingUserId: string): Promise<ReapplyOutcome> {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.feeInvoice.findUnique({ where: { id: invoiceId } })
    if (!inv || !inv.classSectionId) return { ok: false as const, reason: 'Not a group invoice' }
    if (inv.status === 'CANCELLED' || inv.status === 'PAID') return { ok: false as const, reason: 'The invoice is already paid or cancelled' }
    const base = Number(inv.subtotal)
    const result = await computeForInvoice(tx, inv.studentId, inv.classSectionId, base, { excludeInvoiceId: inv.id })
    const totalAmount = Math.round((base + Number(inv.lateFee) - result.total) * 100) / 100
    const paid = Number(inv.paidAmount)
    if (paid > totalAmount) return { ok: false as const, reason: 'The student already paid more than the new total; this needs a refund' }
    const status = totalAmount <= 0 || paid >= totalAmount ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : inv.status
    // Undo the previous lines (and their usage counts), then record the new ones.
    const old = await tx.invoiceDiscount.findMany({ where: { invoiceId } })
    for (const o of old) {
      if (o.assignmentId) await tx.discountAssignment.update({ where: { id: o.assignmentId }, data: { timesUsed: { decrement: 1 } } })
    }
    await tx.invoiceDiscount.deleteMany({ where: { invoiceId } })
    await recordInvoiceDiscounts(tx, invoiceId, inv.studentId, result, actingUserId)
    await tx.feeInvoice.update({ where: { id: invoiceId }, data: { discount: result.total, totalAmount, status } })
    return { ok: true as const, discount: result.total, totalAmount, status }
  })
}

/** Unpaid group invoices this discount could still be applied to (the "ask" step). */
export async function invoicesAffectedBy(assignment: { studentId: string | null; classSectionId: string | null; trackId: string | null }) {
  const where: Prisma.FeeInvoiceWhereInput = {
    status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
    classSectionId: { not: null },
    classSection: { status: 'ACTIVE' },
  }
  if (assignment.studentId) where.studentId = assignment.studentId
  if (assignment.classSectionId) where.classSectionId = assignment.classSectionId
  if (assignment.trackId) where.level = { subject: { trackId: assignment.trackId } }
  return prisma.feeInvoice.findMany({
    where,
    select: { id: true, challanNumber: true, month: true, totalAmount: true, paidAmount: true, student: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

// ── approvals ───────────────────────────────────────────────────────────────
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY', 'MARKETING', 'TEACHER'] as const

export function canApproveDiscounts(role: string) {
  return checkPermission(role as never, 'discount_approvals', 'approve')
}

/** Notifies everyone who can approve discounts (never breaks the main action). */
export async function notifyApprovers(title: string, message: string, relatedId: string) {
  try {
    const roles = ROLES.filter((r) => canApproveDiscounts(r))
    const users = await prisma.user.findMany({ where: { role: { in: [...roles] }, isActive: true }, select: { id: true } })
    if (users.length) {
      await prisma.notification.createMany({
        data: users.map((u) => ({ userId: u.id, title, message, type: 'DISCOUNT_REQUEST', relatedId })),
      })
    }
  } catch (err) {
    console.error('[DISCOUNT_NOTIFY]', err)
  }
}
