/**
 * GET /api/budgets?year&month&campusId — FIN-2: budget vs actual per expense category (campusId empty = company).
 * PUT { year, month, campusId|null, categoryId, amount } — set a monthly budget (0 removes it).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { successResponse } from '@/lib/api-response'
import { budgetVsActual, setBudget } from '@/lib/budget/engine'

export const dynamic = 'force-dynamic'
const schema = z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12), campusId: z.string().max(40).nullable(), categoryId: z.string().min(1).max(40), amount: z.number().min(0).max(100000000) })

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'expenses', 'read')) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const now = new Date()
  const year = Number(sp.get('year')) || now.getUTCFullYear()
  const month = Number(sp.get('month')) || now.getUTCMonth() + 1
  try { return successResponse(await budgetVsActual(session.user, year, month, sp.get('campusId') || null)) } catch (e) { return errors.forbidden((e as Error).message) }
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { await setBudget(session.user, parsed.data as { year: number; month: number; campusId: string | null; categoryId: string; amount: number }); return successResponse({ ok: true }) } catch (e) { return errors.forbidden((e as Error).message) }
}
