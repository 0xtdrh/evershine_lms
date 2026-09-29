/**
 * GET  /api/admin/setup  — preview of the initial setup (what is done / to do)
 * POST /api/admin/setup  — apply it (idempotent)
 * Super Admin only (role re-checked in the DB). See lib/setup/initial-setup.ts.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { applyInitialSetup, planInitialSetup } from '@/lib/setup/initial-setup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error
  return successResponse({ steps: await planInitialSetup() })
}

export async function POST(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error
  try {
    const before = await planInitialSetup()
    const steps = await applyInitialSetup()
    try {
      await logAudit({
        prismaClient: prisma,
        userId: userId!,
        action: 'UPDATE',
        entityType: 'InitialSetup',
        changes: { applied: before.filter((s) => s.status === 'TODO').map((s) => s.key) },
        request,
      })
    } catch (auditErr) {
      console.error('[SETUP_AUDIT]', auditErr)
    }
    return successResponse({ steps }, 'Initial setup applied')
  } catch (err) {
    console.error('[SETUP_APPLY]', err)
    return errorResponse('SETUP_FAILED', err instanceof Error ? err.message : 'Setup failed', 500)
  }
}
