/**
 * Loads Permissions-page overrides (RolePermission rows) into lib/rbac.ts.
 *
 * Server-only. Called from auth() (lib/auth.ts), so every API route that checks
 * a session has fresh overrides before it calls checkPermission.
 *
 * Refreshed at most every 30s per server instance: a change on the Permissions
 * page reaches every instance within ~30s (immediately on the instance that
 * saved it). If the DB read fails, the last loaded overrides (or the static
 * matrix) keep applying; a failure never blocks a request.
 */

import { prisma } from '@/lib/prisma'
import { setPermissionOverrides } from '@/lib/rbac'

const TTL_MS = 30_000

let loadedAt = 0
let inflight: Promise<void> | null = null

export async function ensurePermissionOverrides(): Promise<void> {
  if (Date.now() - loadedAt < TTL_MS) return
  if (!inflight) {
    inflight = prisma.rolePermission
      .findMany({ select: { role: true, resource: true, action: true, isEnabled: true } })
      .then((rows) => {
        setPermissionOverrides(rows)
        loadedAt = Date.now()
      })
      .catch((error) => {
        console.error('[RBAC_OVERRIDES_LOAD_FAILED]', error)
        // Retry on a later request instead of hammering the DB on every call.
        loadedAt = Date.now() - TTL_MS + 5_000
      })
      .finally(() => {
        inflight = null
      })
  }
  await inflight
}

/** Call after the Permissions page saves or deletes an override. */
export async function reloadPermissionOverrides(): Promise<void> {
  loadedAt = 0
  await ensurePermissionOverrides()
}
