/**
 * FIN-2 extra fees + platform fee — fee types and their rules, charging what is due when a monthly invoice is made
 * (one separate "fees" invoice, no group, so instructor % pay and group money are untouched), adding an optional fee
 * by hand, and the consequences of an unpaid fee (lock the learning platform / no next month / mid-month warning).
 * Server-only. Pure rules in ./rules.ts.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { createWithInvoiceNumber } from '@/lib/fees/challan-number'
import { invoiceDueDate, paymentAccountsSnapshot } from '@/lib/fees/payment-settings'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { activeConsequences, DEFAULT_FEES_SETTINGS, periodKey, resolveFee, type FeeContext, type FeeFrequency, type FeesSettings, type OnUnpaid } from './rules'

const KEY = 'fees.settings'
export const getFeesSettings = () => getSetting<FeesSettings>(KEY, DEFAULT_FEES_SETTINGS)
export async function saveFeesSettings(v: Partial<FeesSettings>, userId: string) {
  const next = { ...(await getFeesSettings()), ...v }
  await setSetting(KEY, next, userId)
  return next
}

export class FeeError extends Error {}
const num = (v: unknown) => Number(v ?? 0)
const r2 = (n: number) => Math.round(n * 100) / 100

/** Where a student stands for the fee rules: the group's place, partner, track, course, level, the group and the student. */
export async function feeContext(studentId: string, classSectionId: string | null): Promise<FeeContext> {
  const ctx: FeeContext = { STUDENT: studentId }
  if (classSectionId) {
    const g = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { id: true, campusId: true, levelId: true, campus: { select: { partnerId: true } }, level: { select: { subjectId: true, subject: { select: { trackId: true } } } } } })
    if (g) Object.assign(ctx, { GROUP: g.id, CAMPUS: g.campusId, PARTNER: g.campus?.partnerId ?? null, LEVEL: g.levelId, COURSE: g.level?.subjectId ?? null, TRACK: g.level?.subject?.trackId ?? null })
  } else {
    const s = await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true, campus: { select: { partnerId: true } } } })
    if (s) Object.assign(ctx, { CAMPUS: s.campusId, PARTNER: s.campus?.partnerId ?? null })
  }
  return ctx
}

interface Line { feeTypeId: string; name: string; amount: number; periodKey: string; onUnpaid: OnUnpaid }

async function createFeesInvoice(studentId: string, lines: Line[], opts: { issuedBy: string; levelId?: string | null; academicYear: string; label: string }): Promise<string | null> {
  if (!lines.length) return null
  const total = r2(lines.reduce((s, l) => s + l.amount, 0))
  if (total <= 0) return null
  const [dueDate, bankAccounts] = await Promise.all([invoiceDueDate(), paymentAccountsSnapshot()])
  try {
    return await prisma.$transaction(async (tx) => {
      const inv = await createWithInvoiceNumber((challanNumber) => tx.feeInvoice.create({
        data: {
          challanNumber, studentId, month: opts.label.slice(0, 190), academicYear: opts.academicYear, dueDate, subtotal: total, discount: 0,
          totalAmount: total, status: 'ISSUED', bankAccounts, issuedBy: opts.issuedBy, levelId: opts.levelId ?? null,
          items: { create: lines.map((l) => ({ description: l.name, amount: l.amount })) },
        },
      }), tx)
      await tx.studentFeeCharge.createMany({ data: lines.map((l) => ({ feeTypeId: l.feeTypeId, studentId, periodKey: l.periodKey, invoiceId: inv.id, amount: l.amount, onUnpaid: l.onUnpaid })) })
      return inv.id
    })
  } catch (err) {
    // two invoices at the same moment already charged this period: nothing to add
    if (isUniqueConflictOn(err, 'feeTypeId') || isUniqueConflictOn(err, 'periodKey') || isUniqueConflictOn(err, 'StudentFeeCharge')) return null
    throw err
  }
}

/**
 * Charges every REQUIRED fee that is due for this student in this group (not charged for its period yet) on ONE fees
 * invoice. Called when a monthly / level invoice is made (createCycleInvoice). Never throws.
 */
export async function chargeDueFees(studentId: string, classSectionId: string, opts: { issuedBy: string; academicYear: string; at?: Date }): Promise<string | null> {
  try {
    const types = await prisma.feeType.findMany({ where: { isActive: true, frequency: { not: 'MANUAL' } }, include: { rules: true }, orderBy: { sortOrder: 'asc' } })
    if (!types.length) return null
    const ctx = await feeContext(studentId, classSectionId)
    const at = opts.at ?? new Date()
    const lines: Line[] = []
    for (const t of types) {
      const r = resolveFee({ amount: num(t.amount), frequency: t.frequency as FeeFrequency, defaultMode: t.defaultMode, onUnpaid: t.onUnpaid }, t.rules.map((x) => ({ ...x, amount: x.amount === null ? null : num(x.amount) })), ctx)
      if (r.mode !== 'REQUIRED' || r.amount <= 0) continue
      const key = periodKey(r.frequency, { date: at, levelId: ctx.LEVEL })
      if (!key) continue
      const done = await prisma.studentFeeCharge.findUnique({ where: { feeTypeId_studentId_periodKey: { feeTypeId: t.id, studentId, periodKey: key } } })
      if (done) continue
      lines.push({ feeTypeId: t.id, name: t.nameAr ? `${t.nameEn} / ${t.nameAr}` : t.nameEn, amount: r.amount, periodKey: key, onUnpaid: r.onUnpaid })
    }
    if (!lines.length) return null
    return await createFeesInvoice(studentId, lines, { issuedBy: opts.issuedBy, levelId: ctx.LEVEL, academicYear: opts.academicYear, label: `Fees — ${lines.map((l) => l.name.split(' / ')[0]).join(', ')}` })
  } catch (err) {
    console.error('[FEES_CHARGE]', err)
    return null
  }
}

/** Staff add a fee to one student by hand (an optional fee, a kit, a certificate…). */
export async function addFee(user: { id: string }, studentId: string, feeTypeId: string, amount?: number | null) {
  const t = await prisma.feeType.findUnique({ where: { id: feeTypeId }, include: { rules: true } })
  if (!t || !t.isActive) throw new FeeError('Fee not found')
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, academicYear: true, enrollments: { where: { status: 'ACTIVE' }, select: { classSectionId: true }, take: 1 } } })
  if (!student) throw new FeeError('Student not found')
  const ctx = await feeContext(studentId, student.enrollments[0]?.classSectionId ?? null)
  const r = resolveFee({ amount: num(t.amount), frequency: t.frequency as FeeFrequency, defaultMode: t.defaultMode, onUnpaid: t.onUnpaid }, t.rules.map((x) => ({ ...x, amount: x.amount === null ? null : num(x.amount) })), ctx)
  const key = periodKey(r.frequency, { date: new Date(), levelId: ctx.LEVEL }) ?? `M:${Date.now().toString(36)}`
  if (await prisma.studentFeeCharge.findUnique({ where: { feeTypeId_studentId_periodKey: { feeTypeId: t.id, studentId, periodKey: key } } })) throw new FeeError('Already charged for this period')
  const id = await createFeesInvoice(studentId, [{ feeTypeId: t.id, name: `${t.nameEn} / ${t.nameAr}`, amount: amount ?? r.amount, periodKey: key, onUnpaid: r.onUnpaid }], { issuedBy: user.id, levelId: ctx.LEVEL, academicYear: student.academicYear, label: `Fee — ${t.nameEn}` })
  if (!id) throw new FeeError('Nothing to charge')
  const { autoPay } = await import('@/lib/wallet/engine')
  await autoPay(studentId, { userId: user.id, preferInvoiceId: id })
  return id
}

/** Active consequences of unpaid fees for one student (LOCK_LMS, BLOCK_NEXT, COUNT_WARNING). */
export async function feeConsequences(studentId: string): Promise<Set<OnUnpaid>> {
  const charges = await prisma.studentFeeCharge.findMany({ where: { studentId, onUnpaid: { not: 'REMIND' } }, select: { onUnpaid: true, invoiceId: true } })
  if (!charges.length) return new Set()
  const inv = new Map((await prisma.feeInvoice.findMany({ where: { id: { in: charges.map((c) => c.invoiceId) } }, select: { id: true, status: true, dueDate: true, totalAmount: true, paidAmount: true } })).map((i) => [i.id, i]))
  return activeConsequences(charges.filter((c) => inv.has(c.invoiceId)).map((c) => { const i = inv.get(c.invoiceId)!; return { onUnpaid: c.onUnpaid, invoice: { status: i.status, dueDate: i.dueDate, totalAmount: num(i.totalAmount), paidAmount: num(i.paidAmount) } } }))
}

/** Students (of a list) who may not move to the next month / level because of an unpaid fee. */
export async function blockedForNext(studentIds: string[]): Promise<string[]> {
  const out: string[] = []
  for (const id of [...new Set(studentIds)]) if ((await feeConsequences(id)).has('BLOCK_NEXT')) out.push(id)
  return out
}

/** Ids of fees invoices (for the wallet's pay-first order). */
export async function feeInvoiceIds(studentId: string): Promise<Set<string>> {
  return new Set((await prisma.studentFeeCharge.findMany({ where: { studentId }, select: { invoiceId: true } })).map((c) => c.invoiceId))
}

// ── management ──────────────────────────────────────────────────────────────────────────────────────────────

export interface FeeTypeInput { nameEn: string; nameAr: string; amount: number; frequency: string; isPlatform?: boolean; defaultMode?: string; onUnpaid?: string; isActive?: boolean; sortOrder?: number }

export async function listFeeTypes() {
  const rows = await prisma.feeType.findMany({ include: { rules: true }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { nameEn: 'asc' }] })
  return rows.map((t) => ({ ...t, amount: num(t.amount), rules: t.rules.map((r) => ({ ...r, amount: r.amount === null ? null : num(r.amount) })) }))
}

export async function saveFeeType(input: FeeTypeInput, id?: string) {
  const data: Prisma.FeeTypeUncheckedCreateInput = {
    nameEn: input.nameEn.trim().slice(0, 80), nameAr: input.nameAr.trim().slice(0, 80), amount: input.amount, frequency: input.frequency,
    isPlatform: !!input.isPlatform, defaultMode: input.defaultMode ?? 'OPTIONAL', onUnpaid: input.onUnpaid ?? 'REMIND', isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0,
  }
  return id ? prisma.feeType.update({ where: { id }, data }) : prisma.feeType.create({ data })
}

export async function saveFeeRule(feeTypeId: string, input: { scopeType: string; scopeId: string; mode: string; amount?: number | null; frequency?: string | null; onUnpaid?: string | null }) {
  await prisma.feeRule.deleteMany({ where: { feeTypeId, scopeType: input.scopeType, scopeId: input.scopeId } })
  return prisma.feeRule.create({ data: { feeTypeId, scopeType: input.scopeType, scopeId: input.scopeId, mode: input.mode, amount: input.amount ?? null, frequency: input.frequency || null, onUnpaid: input.onUnpaid || null } })
}

export const deleteFeeRule = (id: string) => prisma.feeRule.delete({ where: { id } })
