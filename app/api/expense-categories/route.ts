/** GET /api/expense-categories (?all=1 with hidden) — FIN-1 editable expense categories; POST { nameEn, nameAr } — add one. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { expenseCategories, saveExpenseCategory } from '@/lib/treasury/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({ nameEn: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(2).max(80), isActive: z.boolean().optional(), sortOrder: z.number().int().optional() })

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'expenses', 'read')) return errors.forbidden()
  return successResponse(await expenseCategories(request.nextUrl.searchParams.get('all') === '1'))
}

async function POST_(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'expenses', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return createdResponse(await saveExpenseCategory(parsed.data as { nameEn: string; nameAr: string; isActive?: boolean; sortOrder?: number }))
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
