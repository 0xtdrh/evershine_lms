/**
 * GET  /api/admin/login-locks — accounts / IPs paused right now after too many
 *                               wrong passwords (lib/login-throttle.ts)
 * POST /api/admin/login-locks — body { kind: 'account' | 'ip', value } unlocks one
 *
 * Super Admin only (role re-checked in the DB).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { listLocks, unlock, LOCK_MINUTES, MAX_FAILS_PER_ACCOUNT, MAX_FAILS_PER_IP } from '@/lib/login-throttle'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error
  return successResponse({
    locks: await listLocks(),
    rules: { lockMinutes: LOCK_MINUTES, maxFailsPerAccount: MAX_FAILS_PER_ACCOUNT, maxFailsPerIp: MAX_FAILS_PER_IP },
  })
}

const bodySchema = z.object({ kind: z.enum(['account', 'ip']), value: z.string().min(1).max(191) })

export async function POST(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.badRequest('kind (account | ip) and value are required')

  const removed = await unlock(parsed.data.kind, parsed.data.value)
  try {
    await logAudit({
      prismaClient: prisma,
      userId: userId!,
      action: 'UPDATE',
      entityType: 'LoginLock',
      changes: { unlocked: parsed.data, removedAttempts: removed },
      request,
    })
  } catch (auditErr) {
    console.error('[LOGIN_UNLOCK_AUDIT]', auditErr)
  }
  return successResponse({ removed }, 'Unlocked')
}
