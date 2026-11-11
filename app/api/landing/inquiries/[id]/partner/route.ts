/**
 * POST /api/landing/inquiries/[id]/partner — x01: turn a website request (school / partnership / solution) into a
 * possible partner. Uses the partners engine (savePartner) so every partner rule applies; the partner starts STOPPED
 * (isActive false) until a deal is made. RBAC partners:create. The request keeps the link (partnerId) and becomes RESOLVED.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { savePartner } from '@/lib/partners/engine'

const KIND: Record<string, string> = { SCHOOL: 'SCHOOL', SOLUTION: 'COMPANY', PARTNER: 'OTHER' }

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'partners', 'create')) return errors.forbidden()
  const { id } = await params
  const lead = await prisma.landingInquiry.findUnique({ where: { id } })
  if (!lead) return errors.notFound('Request')
  if (lead.partnerId) return successResponse({ partnerId: lead.partnerId, existing: true })
  const name = (lead.organisation || lead.name).trim()
  const existing = await prisma.partner.findFirst({ where: { name }, select: { id: true } })
  let partnerId = existing?.id
  if (!partnerId) {
    const saved = await savePartner(session.user.id, null, {
      name,
      kind: KIND[lead.kind ?? ''] ?? 'OTHER',
      contactName: lead.name,
      contactPhone: lead.phone,
      contactEmail: lead.email,
      notes: [`Possible partner from the website (${new Date(lead.createdAt).toISOString().slice(0, 10)}) · شريك محتمل من الموقع`, lead.topic, lead.message].filter(Boolean).join('\n'),
      isActive: false,
    })
    if (!saved.ok) return errors.badRequest('message' in saved ? saved.message : 'Could not create the partner')
    partnerId = saved.value.id
  }
  await prisma.landingInquiry.update({ where: { id }, data: { partnerId, status: 'RESOLVED', repliedAt: new Date(), repliedBy: session.user.id } })
  return successResponse({ partnerId, existing: !!existing })
}
