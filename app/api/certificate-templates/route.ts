import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import { uploadProfileImageToCloudinary } from '@/lib/cloudinary'
import type { Role } from '@prisma/client'

const fieldSchema = z.object({
  key: z.enum(['studentName', 'courseName', 'levelName', 'issueDate', 'certificateId', 'qrCode']),
  label: z.string(),
  x: z.number().min(0).max(100), // percentage position from left
  y: z.number().min(0).max(100), // percentage position from top
  fontSizePx: z.number().min(6).max(200).default(24),
  fontFamily: z.string().default('serif'),
  color: z.string().default('#1e293b'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  bold: z.boolean().default(false),
})

const createTemplateSchema = z.object({
  name: z.string().min(2),
  backgroundBase64: z.string().min(10),
  widthPx: z.number().min(200).max(4000).default(1600),
  heightPx: z.number().min(200).max(4000).default(1131),
  fieldLayout: z.array(fieldSchema).default([]),
  isDefault: z.boolean().default(false),
})

/** GET /api/certificate-templates — list every uploaded design. */
export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  const templates = await prisma.certificateTemplate.findMany({
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
  return successResponse(templates)
}

/** POST /api/certificate-templates — upload a new design. */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'create')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = createTemplateSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  let backgroundUrl: string
  try {
    backgroundUrl = await uploadProfileImageToCloudinary(
      data.backgroundBase64,
      'certificates',
      `template-${Date.now()}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Image upload failed'
    return errors.validation({ errors: [{ path: ['backgroundBase64'], message }] } as never)
  }

  const template = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.certificateTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }
    return tx.certificateTemplate.create({
      data: {
        name: data.name,
        backgroundUrl,
        widthPx: data.widthPx,
        heightPx: data.heightPx,
        fieldLayout: data.fieldLayout,
        isDefault: data.isDefault,
        createdBy: session.user.id,
      },
    })
  })

  return createdResponse(template, 'Certificate template created')
}
