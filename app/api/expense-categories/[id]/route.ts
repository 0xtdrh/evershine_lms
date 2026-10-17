/** PATCH /api/expense-categories/[id] { nameEn, nameAr, isActive?, sortOrder? } — FIN-1: rename / hide a category. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { saveExpenseCategory } from '@/lib/treasury/engine'

const schema = z.object({ nameEn: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(2).max(80), isActive: z.boolean().optional(), sortOrder: z.number().int().optional() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'expenses', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveExpenseCategory(parsed.data as { nameEn: string; nameAr: string; isActive?: boolean; sortOrder?: number }, (await params).id))
}
