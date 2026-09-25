import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { createCycleInvoice } from './sync-progress'

export interface GenerateInvoicesResult {
  generated: number
  skipped: number // already had an invoice for this cycle
}

/**
 * Ensures every currently-active student in a group has an invoice for the
 * group's CURRENT cycle (the one it's on right now — not a past or future
 * one). Safe to call repeatedly: students who already have one are skipped.
 *
 * Used for:
 * - backfilling a group whose first cycle never got billed (it only starts
 *   getting invoices automatically once a cycle *closes*, which a brand-new
 *   group hasn't done yet)
 * - billing a student the moment they're added to a group mid-cycle
 */
export async function generateMissingCycleInvoices(
  classSectionId: string,
  actingUserId: string,
  onlyForStudentId?: string
): Promise<GenerateInvoicesResult> {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    include: {
      level: { include: { subject: true } },
      enrollments: {
        where: { status: 'ACTIVE', ...(onlyForStudentId && { studentId: onlyForStudentId }) },
        select: { studentId: true },
      },
    },
  })
  if (!group || !group.level) return { generated: 0, skipped: 0 }

  const cycleNumber = group.level.pricingType === 'MONTHLY' ? group.currentCycleNumber : null
  const amount = Number(group.level.pricingType === 'MONTHLY' ? group.level.monthlyPrice ?? 0 : group.level.fullLevelPrice ?? 0)
  if (amount <= 0) return { generated: 0, skipped: 0 }

  const activeYear = await getActiveAcademicYear()
  const academicYearName = activeYear?.name ?? new Date().getFullYear().toString()

  let generated = 0
  let skipped = 0

  for (const e of group.enrollments) {
    const existing = await prisma.feeInvoice.findFirst({
      where: { studentId: e.studentId, classSectionId, cycleNumber },
    })
    if (existing) {
      skipped++
      continue
    }
    await createCycleInvoice({
      studentId: e.studentId,
      classSectionId,
      levelId: group.levelId!,
      cycleNumber,
      amount,
      academicYearName,
      issuedBy: actingUserId,
      label: cycleNumber
        ? `${group.level.subject.name} — ${group.level.name} — Month ${cycleNumber}`
        : `${group.level.subject.name} — ${group.level.name}`,
    })
    generated++
  }

  return { generated, skipped }
}
