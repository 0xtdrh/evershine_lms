/** Six phases 1-a: enrolment codes — batches, checking, using, and turning a used code into a discount (server only). */

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { checkCode, makeCode, normalizeCode, type BatchInput } from './codes'
import type { CodeTarget } from '@/lib/bookings/rules'

/** Makes a batch of codes. Each batch gets ONE discount type (shown in Discounts as «كود: BATCH»). */
export async function createBatch(userId: string, v: BatchInput) {
  const valueType = v.kind === 'AMOUNT' ? 'FIXED' : 'PERCENT'
  const full = v.kind === 'FREE' || v.kind === 'PREPAID'
  const value = full ? 100 : v.value
  const type = await prisma.discountType.create({
    data: {
      name: `${v.kind === 'PREPAID' ? 'Prepaid' : 'Code'}: ${v.batch.toUpperCase()}`.slice(0, 80), kind: 'PROMO', valueType, value, duration: v.duration,
      autoApply: false, approvalMode: 'STAFF', scopeType: 'ALL', stackable: true, ignoresCap: full, isActive: true, createdById: userId,
      validTo: v.expiresAt ? new Date(`${v.expiresAt}T23:59:59Z`) : null,
    },
  })
  const made: string[] = []
  for (let tries = 0; made.length < v.count && tries < v.count * 5; tries++) {
    const code = makeCode(v.batch, randomInt, v.count === 1 ? 4 : 6)
    try {
      await prisma.enrolmentCode.create({
        data: {
          code, batch: v.batch.toUpperCase(), kind: v.kind, value, duration: v.duration, scope: v.scope, scopeIds: v.scopeIds,
          maxUses: v.maxUses, expiresAt: v.expiresAt ? new Date(`${v.expiresAt}T23:59:59Z`) : null, partnerId: v.partnerId || null,
          note: v.note || null, discountTypeId: type.id, createdById: userId, unlocks: v.unlocks, startLevelId: v.startLevelId || null,
        },
      })
      made.push(code)
    } catch { /* the same code already exists: try another */ }
  }
  return { batch: v.batch.toUpperCase(), codes: made, discountTypeId: type.id }
}

export async function listBatches() {
  const rows = await prisma.enrolmentCode.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 })
  const map = new Map<string, { batch: string; kind: string; value: number; scope: string; maxUses: number | null; expiresAt: Date | null; createdAt: Date; codes: number; used: number; active: number; partnerId: string | null; note: string | null }>()
  for (const r of rows) {
    const b = map.get(r.batch) ?? { batch: r.batch, kind: r.kind, value: r.value, scope: r.scope, maxUses: r.maxUses, expiresAt: r.expiresAt, createdAt: r.createdAt, codes: 0, used: 0, active: 0, partnerId: r.partnerId, note: r.note }
    b.codes++; b.used += r.uses; if (r.isActive) b.active++
    map.set(r.batch, b)
  }
  return [...map.values()]
}

export const batchCodes = (batch: string) => prisma.enrolmentCode.findMany({ where: { batch: batch.toUpperCase() }, orderBy: { code: 'asc' } })
export const setBatchActive = (batch: string, on: boolean) => prisma.enrolmentCode.updateMany({ where: { batch: batch.toUpperCase() }, data: { isActive: on } })

/** Checks a code for a course page and a phone (public). */
export async function lookupCode(raw: string, listing: string | null, phone: string | null, target?: CodeTarget) {
  const code = normalizeCode(raw)
  const row = code ? await prisma.enrolmentCode.findUnique({ where: { code } }) : null
  const usedByPhone = !!(row && phone && (await prisma.enrolmentCodeUse.count({ where: { codeId: row.id, phone } })))
  const res = checkCode(row, { listing, today: cairoToday(), usedByPhone, target })
  return { code, row, res }
}

/** Records one use (inside the sign-up). Refuses when the code ran out meanwhile. */
export async function useCode(codeId: string, phone: string, admissionRequestId: string | null) {
  const updated = await prisma.enrolmentCode.updateMany({
    where: { id: codeId, isActive: true, OR: [{ maxUses: null }, { uses: { lt: prisma.enrolmentCode.fields.maxUses } }] },
    data: { uses: { increment: 1 } },
  })
  if (!updated.count) return false
  await prisma.enrolmentCodeUse.create({ data: { codeId, phone, admissionRequestId } })
  return true
}

/**
 * Called when staff approve a website request that carried a code: the code becomes a normal, approved discount for that
 * student (in the chosen group when there is one), so the invoice made for the group takes it off.
 */
export async function applyCodeToStudent(codeText: string | null | undefined, studentId: string, classSectionId: string | null, staffUserId: string) {
  if (!codeText) return null
  const row = await prisma.enrolmentCode.findUnique({ where: { code: normalizeCode(codeText) } })
  if (!row?.discountTypeId) return null
  const exists = await prisma.discountAssignment.findFirst({ where: { discountTypeId: row.discountTypeId, studentId, status: 'ACTIVE' }, select: { id: true } })
  if (exists) return exists.id
  const a = await prisma.discountAssignment.create({
    data: {
      discountTypeId: row.discountTypeId, studentId, classSectionId, value: row.kind === 'FREE' || row.kind === 'PREPAID' ? 100 : row.value, status: 'ACTIVE',
      reason: `${row.kind === 'PREPAID' ? 'Prepaid code' : 'Enrolment code'} ${row.code} · ${row.kind === 'PREPAID' ? 'كود مدفوع مقدماً' : 'كود تسجيل'}`, requestedById: staffUserId, approvedById: staffUserId, approvedAt: new Date(),
    },
  })
  return a.id
}
