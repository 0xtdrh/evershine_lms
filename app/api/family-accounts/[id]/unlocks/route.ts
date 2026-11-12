/**
 * POST   /api/family-accounts/[id]/unlocks { refType, refId, person?: 'm:<id>'|'s:<id>', note } — open a track / course outside the
 *        age for the whole family (no person) or one child (family_accounts:update).
 * DELETE /api/family-accounts/[id]/unlocks?unlockId= — take it back.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { addUnlock, familyOf } from '@/lib/accounts/engine'
import { canSeeAccount, staffSession } from '@/lib/accounts/staff'

const schema = z.object({ refType: z.enum(['TRACK', 'COURSE']), refId: z.string().min(1).max(40), person: z.string().max(60).optional().nullable(), note: z.string().trim().max(200).optional().nullable() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('update')
  if (s.error) return s.error
  const { id } = await params
  if (!(await canSeeAccount(s.user, id))) return errors.notFound('Account')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  const exists = v.refType === 'TRACK'
    ? await prisma.track.count({ where: { id: v.refId } })
    : await prisma.academicSubject.count({ where: { id: v.refId } })
  if (!exists) return errors.badRequest('Choose a track or a course · اختار تراك أو كورس')
  let memberId: string | null = null
  let studentId: string | null = null
  if (v.person) {
    const p = (await familyOf(id)).find((x) => x.key === v.person)
    if (!p) return errors.badRequest('Not in this family · مش في العيلة دي')
    if (p.studentId) studentId = p.studentId
    else memberId = p.memberId
  }
  const row = await addUnlock(s.user.id, { guardianId: v.person ? null : id, memberId, studentId, refType: v.refType, refId: v.refId, note: v.note })
  return createdResponse(row)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('update')
  if (s.error) return s.error
  const { id } = await params
  if (!(await canSeeAccount(s.user, id))) return errors.notFound('Account')
  const unlockId = request.nextUrl.searchParams.get('unlockId') ?? ''
  const people = await familyOf(id)
  const r = await prisma.courseUnlock.deleteMany({
    where: { id: unlockId, OR: [{ guardianId: id }, { memberId: { in: people.map((p) => p.memberId).filter(Boolean) as string[] } }, { studentId: { in: people.map((p) => p.studentId).filter(Boolean) as string[] } }] },
  })
  return r.count ? successResponse({ ok: true }) : errors.notFound('Unlock')
}
