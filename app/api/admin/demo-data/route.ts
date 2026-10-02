/**
 * GET    /api/admin/demo-data — how many demo records exist (scripts/live-check.mjs)
 * DELETE /api/admin/demo-data — removes ONLY demo records (lib/setup/demo-data.ts)
 * Super Admin only.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { demoCounts, findDemoIds, removeDemoData } from '@/lib/setup/demo-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error
  return successResponse(demoCounts(await findDemoIds()))
}

export async function DELETE(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error
  try {
    const deleted = await removeDemoData()
    try {
      await logAudit({ prismaClient: prisma, userId: userId!, action: 'DELETE', entityType: 'DemoData', changes: { deleted }, request })
    } catch (err) {
      console.error('[DEMO_DATA_AUDIT]', err)
    }
    return successResponse({ deleted }, 'Demo data removed')
  } catch (err) {
    console.error('[DEMO_DATA_REMOVE]', err)
    return errorResponse('DEMO_REMOVE_FAILED', err instanceof Error ? err.message : 'Could not remove demo data', 500)
  }
}
