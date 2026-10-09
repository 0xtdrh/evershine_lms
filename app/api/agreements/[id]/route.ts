/**
 * PATCH /api/agreements/[id] — edit. Changing a title or text publishes a NEW VERSION (everyone accepts again).
 * GET   /api/agreements/[id] — who accepted the current version / who is pending (?format=csv to export)
 * POST  /api/agreements/[id] { action: 'remind' } — notify everyone still pending
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { agreementStatus } from '@/lib/agreements/engine'
import { agreementSchema } from '@/lib/agreements/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'read')
  if (denied) return denied
  const { id } = await params
  const st = await agreementStatus(id)
  if (!st) return errors.notFound('Agreement')
  if (new URL(request.url).searchParams.get('format') === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Name', 'Role', 'Contact', 'Accepted at', 'Device'].map(esc).join(','), ...st.rows.map((r) => [r.name, r.role, r.contact, r.acceptedAt ? new Date(r.acceptedAt).toISOString() : 'PENDING', r.device ?? ''].map(esc).join(','))]
    return new NextResponse('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="agreement-${st.agreement.key}-v${st.agreement.version}.csv"` } })
  }
  return successResponse(st)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const { id } = await params
  const a = await prisma.agreement.findUnique({ where: { id } })
  if (!a) return errors.notFound('Agreement')
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = agreementSchema.omit({ key: true }).partial().safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const textChanged = (['titleEn', 'titleAr', 'bodyEn', 'bodyAr'] as const).some((k) => d[k] !== undefined && d[k] !== a[k])
  const updated = await prisma.agreement.update({
    where: { id },
    data: { ...d, updatedById: session.user.id, ...(textChanged && { version: a.version + 1, publishedAt: new Date() }) },
  })
  return successResponse(updated, textChanged ? `Saved as version ${updated.version} — everyone must accept again` : 'Saved')
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const { id } = await params
  const st = await agreementStatus(id)
  if (!st) return errors.notFound('Agreement')
  const pending = st.rows.filter((r) => !r.acceptedAt).map((r) => r.userId)
  if (pending.length) {
    await prisma.notification.createMany({
      data: pending.map((userId) => ({ userId, title: 'Please accept: ' + st.agreement.titleEn, message: 'Open the portal to read and accept it (اقرأ ووافق من البوابة).', type: 'AGREEMENT_REMINDER', relatedId: id })),
    })
  }
  return successResponse({ reminded: pending.length }, `Reminder sent to ${pending.length}`)
}
