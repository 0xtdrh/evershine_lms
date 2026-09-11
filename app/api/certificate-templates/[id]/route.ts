import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import type { Role } from '@prisma/client'

const fieldSchema = z.object({
  key: z.enum(['studentName', 'courseName', 'levelName', 'issueDate', 'certificateId', 'qrCode']),
  label: z.string(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  fontSizePx: z.number().min(6).max(200),
  fontFamily: z.string(),
  color: z.string(),
  align: z.enum(['left', 'center', 'right']),
  bold: z.boolean(),
})

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  fieldLayout: z.array(fieldSchema).optional(),
  isDefault: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'update')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.certificateTemplate.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Certificate template')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.certificateTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } })
    }
    return tx.certificateTemplate.update({
      where: { id },
      data: {
        name: data.name,
        fieldLayout: data.fieldLayout,
        isDefault: data.isDefault,
      },
    })
  })

  return successResponse(updated, 'Certificate template updated')
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'delete')) return errors.forbidden()

  const { id } = await params
  const inUse = await prisma.certificate.findFirst({ where: { templateId: id } })
  if (inUse) return errors.conflict('This template is used by existing certificates and cannot be deleted')

  await prisma.certificateTemplate.delete({ where: { id } })
  return successResponse({ deleted: true })
}
