import { allowsCampus } from '@/lib/places/rules'
import { loadPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse } from '@/lib/api-response'
import { plTotals } from '@/lib/finance/pnl-totals'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (!checkPermission(session.user.role, 'profit_loss', 'update')) {
      return errors.forbidden('Only finance staff can regenerate P&L statements')
    }

    const { id } = await params
    const existing = await prisma.profitLossStatement.findUnique({ where: { id } })
    if (!existing) return errors.notFound('P&L statement not found')

    // Role scoping check
    {
      // M0: statements of the person's places (a company-wide one needs every place)
      const pl = await loadPlaces(session.user)
      if (existing.campusId ? !allowsCampus(pl, existing.campusId) : !pl.all) {
        return errors.forbidden('Cannot regenerate a statement for a different campus')
      }
    }

    const periodStartDate = new Date(existing.periodStart)
    const periodEndDate = new Date(existing.periodEnd)
    const campusId = existing.campusId ?? null
    const profitPercentage = Number(existing.profitPercentage)

    // Same numbers as a new statement (refunds taken off, salaries of the period) — lib/finance/pnl-totals.ts
    const { totalIncome, totalExpenses, feeItems, expenseItems } = await plTotals(periodStartDate, periodEndDate, campusId)

    const grossMargin = totalIncome - totalExpenses
    const pctFraction = profitPercentage / 100
    const superAdminAllocation = grossMargin * pctFraction
    const superAdminMonthlyDraw = superAdminAllocation * 0.75
    const reserveContribution = superAdminAllocation * 0.25
    const remainingAmount = grossMargin - superAdminAllocation

    // Atomic: delete old ledger + statement, then create new statement + ledger
    const statement = await prisma.$transaction(async (tx) => {
      await tx.reserveFundLedger.deleteMany({ where: { profitLossId: id } })
      await tx.profitLossStatement.delete({ where: { id } })

      const stmt = await tx.profitLossStatement.create({
        data: {
          campusId: campusId ?? null,
          periodLabel: existing.periodLabel,
          periodStart: periodStartDate,
          periodEnd: periodEndDate,
          totalIncome,
          totalExpenses,
          grossMargin,
          profitPercentage: profitPercentage,
          superAdminAllocation,
          superAdminMonthlyDraw,
          reserveContribution,
          remainingAmount,
          generatedBy: session.user.id,
          snapshotData: { incomeItems: feeItems, expenseItems },
        },
      })

      const lastEntry = await tx.reserveFundLedger.findFirst({
        where: campusId ? { campusId } : {},
        orderBy: { transactionDate: 'desc' },
        select: { cumulativeTotal: true },
      })

      const previousTotal = Number(lastEntry?.cumulativeTotal ?? 0)
      const cumulativeTotal = previousTotal + reserveContribution

      await tx.reserveFundLedger.create({
        data: {
          profitLossId: stmt.id,
          campusId: campusId ?? null,
          contributionAmount: reserveContribution,
          cumulativeTotal,
          periodLabel: existing.periodLabel,
          notes: null,
        },
      })

      return tx.profitLossStatement.findUnique({ where: { id: stmt.id }, include: { reserveEntry: true } })
    })

    return createdResponse(statement, `P&L statement for ${existing.periodLabel} regenerated successfully`)
  } catch (err) {
    console.error('[PL_REGEN]', err)
    return errors.internal()
  }
}
