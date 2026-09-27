/**
 * GET    /api/teachers/[id]/credentials — list qualifications/training/certificates
 * POST   /api/teachers/[id]/credentials — add one
 * DELETE /api/teachers/[id]/credentials?rowId=... — remove one
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  type: z.enum(['QUALIFICATION', 'TRAINING', 'CERTIFICATE']),
  title: z.string().min(1).max(200),
  institution: z.string().max(200).optional(),
  dateObtained: z.string().optional(),
  fileUrl: z.string().url().optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'read')
  if (denied) return denied

  const { id } = await params
  const rows = await prisma.teacherCredential.findMany({
    where: { teacherId: id },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse(rows)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'update')
  if (denied) return denied

  const { id } = await params
  const teacher = await prisma.teacher.findUnique({ where: { id }, select: { id: true } })
  if (!teacher) return errors.notFound('Teacher')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const row = await prisma.teacherCredential.create({
    data: {
      teacherId: id,
      type: parsed.data.type,
      title: parsed.data.title,
      institution: parsed.data.institution ?? null,
      dateObtained: parsed.data.dateObtained ? new Date(parsed.data.dateObtained) : null,
      fileUrl: parsed.data.fileUrl ?? null,
    },
  })

  return createdResponse(row, 'Credential added')
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'update')
  if (denied) return denied

  const rowId = request.nextUrl.searchParams.get('rowId')
  if (!rowId) return errors.validation({ errors: [{ path: ['rowId'], message: 'rowId is required' }] } as never)

  await prisma.teacherCredential.delete({ where: { id: rowId } })
  return successResponse({ id: rowId, deleted: true })
}
