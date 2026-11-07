/**
 * POST /api/students/duplicates { firstName, lastName, dateOfBirth?, phones[] } — is this child maybe registered already?
 * Used by the admission form before saving (students:create). Rules: lib/students/duplicates.ts.
 */

import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { findDuplicateStudents } from '@/lib/students/duplicates-server'

export const dynamic = 'force-dynamic'

const body = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(''),
  dateOfBirth: z.string().max(40).optional().nullable(),
  phones: z.array(z.string().max(30)).max(6).default([]),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'students', 'create') && !checkPermission(role, 'admissions', 'approve')) return errors.forbidden()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  return successResponse(await findDuplicateStudents({ firstName: d.firstName ?? '', lastName: d.lastName ?? '', dateOfBirth: d.dateOfBirth ?? null, phones: d.phones ?? [] }))
}
