/**
 * M1: GET /api/partner-contract-files/[id] — a 2-minute signed link to a contract file (written to the audit log);
 * ?redirect=1 sends the browser straight to it. DELETE — remove the file.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { contractFileLink, deleteContractFile } from '@/lib/partners/engine'
import { outcome } from '@/lib/partners/http'

type P = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  const r = await contractFileLink(session.user.id, (await params).id)
  if (r.ok && new URL(request.url).searchParams.get('redirect') === '1') return NextResponse.redirect(r.value.url)
  return outcome(r)
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  return outcome(await deleteContractFile(session.user.id, (await params).id), 'Deleted')
}
