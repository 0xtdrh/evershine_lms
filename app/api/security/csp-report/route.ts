/**
 * Security part 3: the browser sends here what the page protection (CSP) would block (watch mode) or blocked.
 * POST is public (browsers send it without a session), size- and rate-limited, stores grouped rows (place only).
 * GET / DELETE: Super Admin (list on Settings → Sign-in security).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { cspEnforced, readCspReports } from '@/lib/security/csp'

export const dynamic = 'force-dynamic'
const MAX_ROWS = 500

export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204 })
  const text = await request.text().catch(() => '')
  if (!text || text.length > 64_000) return done
  if (!(await rateLimit(`csp-report:ip:${requestIp(request)}`, 60, MINUTE)).ok) return done
  let body: unknown
  try { body = JSON.parse(text) } catch { return done }
  for (const r of readCspReports(body)) {
    try {
      const hit = await prisma.cspReport.updateMany({ where: r, data: { count: { increment: 1 }, lastAt: new Date() } })
      if (hit.count === 0 && (await prisma.cspReport.count()) < MAX_ROWS) await prisma.cspReport.create({ data: r })
    } catch { /* a report must never fail loudly (two at the same moment: the unique key wins) */ }
  }
  return done
}

async function superAdmin() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden()
  return null
}

export async function GET() {
  const e = await superAdmin()
  if (e) return e
  const rows = await prisma.cspReport.findMany({ orderBy: { lastAt: 'desc' }, take: 200 })
  return successResponse({ enforced: cspEnforced(), rows })
}

export async function DELETE() {
  const e = await superAdmin()
  if (e) return e
  const r = await prisma.cspReport.deleteMany({})
  return successResponse({ removed: r.count })
}
