/**
 * GET  /api/accountant/profit-loss
 *   ?campusId&year&page&limit
 *   — Lists all historical P&L statements, newest-first.
 *
 * POST /api/accountant/profit-loss
 *   — Generates a new P&L statement for a given period.
 *     Aggregates fee income and expenses from live data, creates a snapshot,
 *     and automatically contributes to the ReserveFundLedger inside one ACID tx.
 *
 * Rules (from schema comments):
 *   grossMargin             = totalIncome - totalExpenses
 *   superAdminAllocation    = grossMargin * (profitPercentage / 100)
 *   reserveContribution     = Account Manager input (defaults to 25%)
 *   superAdminMonthlyDraw   = superAdminAllocation - reserveContribution
 *   remainingAmount         = grossMargin - superAdminAllocation
 */

import { plTotals } from '@/lib/finance/pnl-totals'
import { onePlace } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse, createdResponse, paginatedResponse } from '@/lib/api-response'
import { buildProfitLossReport } from '@/lib/excel/profit-loss-report'
import { cairoToday } from '@/lib/dates/cairo'

const generateSchema = z.object({
  campusId: z.string().cuid().nullable().optional(),
  periodLabel: z.string().min(1).max(50),     // "June 2026"
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  profitPercentage: z.coerce.number()          // e.g. 20 → 20%
    .min(0, 'profitPercentage must be ≥ 0')
    .max(100, 'profitPercentage must be ≤ 100'),
  reserveContribution: z.coerce.number().min(0).optional(),
  notes: z.string().max(500).optional(),
})

const querySchema = z.object({
  campusId: z.string().cuid().optional(),
  year: z.coerce.number().int().min(2000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  export: z.enum(['excel']).optional(),
})

/** M0: a statement is for one of the person's places (or the whole company for someone with every place). */
async function resolveCampusScope(
  sessionUser: { id: string; role: string; campusId?: string | null },
  queryCampusId?: string | null
) {
  return onePlace(await requestPlaces(sessionUser), queryCampusId)
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (!checkPermission(session.user.role, 'profit_loss', 'read')) {
      return errors.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return errors.validation(parsed.error)

    const { campusId: queryCampusId, year, page, limit, export: exportType } = parsed.data
    const scopedCampusId = await resolveCampusScope(session.user, queryCampusId)

    if (session.user.role === 'ACCOUNTANT' && !scopedCampusId) {
      return errors.forbidden('No campus context found for this account')
    }

    const yearStart = year ? new Date(`${year}-01-01T00:00:00.000Z`) : undefined
    const yearEnd = year ? new Date(`${year}-12-31T23:59:59.999Z`) : undefined

    const whereClauses: Prisma.ProfitLossStatementWhereInput[] = []
    if (yearStart) whereClauses.push({ periodStart: { gte: yearStart, lte: yearEnd! } })

    if (scopedCampusId) {
      whereClauses.push(
        session.user.role === 'ACCOUNTANT'
          ? { OR: [{ campusId: scopedCampusId }, { campusId: null }] }
          : { campusId: scopedCampusId }
      )
    }

    const where: Prisma.ProfitLossStatementWhereInput =
      whereClauses.length > 0 ? { AND: whereClauses } : {}

    if (exportType === 'excel') {
      const statements = await prisma.profitLossStatement.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        include: {
          reserveEntry: true,
          campus: { select: { name: true } },
        },
      })

      const campusLabel = scopedCampusId
        ? (await prisma.campus.findUnique({ where: { id: scopedCampusId }, select: { name: true } }))?.name
        : undefined

      const workbook = await buildProfitLossReport(statements, {
        campusLabel,
        year,
      })
      const buffer = await workbook.xlsx.writeBuffer()

      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="profit-loss-statements-${cairoToday()}.xlsx"`,
        },
      })
    }

    const [statements, total] = await Promise.all([
      prisma.profitLossStatement.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { reserveEntry: true },
      }),
      prisma.profitLossStatement.count({ where }),
    ])

    return paginatedResponse(statements, { page, limit, total })
  } catch (err) {
    console.error('[PL_GET]', err)
    return errors.internal()
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (!checkPermission(session.user.role, 'profit_loss', 'create')) {
      return errors.forbidden('Only finance staff can generate P&L statements')
    }

    const body = await req.json()
    const parsed = generateSchema.safeParse(body)
    if (!parsed.success) return errors.validation(parsed.error)

    const { campusId: requestedCampusId, periodLabel, periodStart, periodEnd, profitPercentage, reserveContribution: requestedReserveContribution, notes } = parsed.data
    const scopedCampusId = await resolveCampusScope(session.user, requestedCampusId)

    if (session.user.role === 'ACCOUNTANT' && !scopedCampusId) {
      return errors.forbidden('No campus context found for this account')
    }

    const campusId = scopedCampusId
    const periodStartDate = new Date(periodStart)
    const periodEndDate = new Date(periodEnd)

    if (periodStartDate >= periodEndDate) {
      return errors.badRequest('periodEnd must be after periodStart')
    }

    // Prevent duplicate statement for same campus+period
    const existing = await prisma.profitLossStatement.findFirst({
      where: {
        campusId: campusId ?? null,
        periodLabel,
      },
    })
    if (existing) {
      return errors.conflict(`A P&L statement for "${periodLabel}" already exists for this campus`)
    }

    // ── Aggregate live data (lib/finance/pnl-totals.ts, shared with regenerate + the monthly report) ──
    const { totalIncome, totalExpenses, feeItems, expenseItems } = await plTotals(periodStartDate, periodEndDate, campusId ?? null)

    // ── Apply business rules ──────────────────────────────────────────────────
    const grossMargin = totalIncome - totalExpenses
    const pctFraction = profitPercentage / 100
    const superAdminAllocation = grossMargin * pctFraction
    const reserveContribution = requestedReserveContribution ?? superAdminAllocation * 0.25
    if (reserveContribution > Math.max(0, superAdminAllocation)) {
      return errors.badRequest('Reserve contribution cannot exceed the SuperAdmin profit allocation')
    }
    const superAdminMonthlyDraw = superAdminAllocation - reserveContribution
    const remainingAmount = grossMargin - superAdminAllocation

    // ── Persist atomically ────────────────────────────────────────────────────
    const statement = await prisma.$transaction(async (tx) => {
      const stmt = await tx.profitLossStatement.create({
        data: {
          campusId: campusId ?? null,
          periodLabel,
          periodStart: periodStartDate,
          periodEnd: periodEndDate,
          totalIncome,
          totalExpenses,
          grossMargin,
          profitPercentage,
          superAdminAllocation,
          superAdminMonthlyDraw,
          reserveContribution,
          remainingAmount,
          generatedBy: session.user.id,
          snapshotData: {
            incomeItems: feeItems,
            expenseItems,
          },
        },
      })

      // Compute cumulative reserve fund total (append-only)
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
          periodLabel,
          notes: notes ?? null,
        },
      })

      return tx.profitLossStatement.findUnique({
        where: { id: stmt.id },
        include: { reserveEntry: true },
      })
    })

    return createdResponse(statement, `P&L statement for ${periodLabel} generated successfully`)
  } catch (err) {
    console.error('[PL_POST]', err)
    return errors.internal()
  }
}
