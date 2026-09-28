import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { DEFAULT_PERMISSION_MATRIX, getAllowedActions, normalizeRole, type AcademicResource, type Action } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/permissions
 *
 * Effective permissions of the logged-in user's role (static matrix + saved
 * Permissions-page overrides). Used by the sidebar to hide/show items.
 * The API routes enforce the same checks; this only drives the UI.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  const role = normalizeRole(session.user.role)
  if (!role) return errors.forbidden()

  const resources = Object.keys(DEFAULT_PERMISSION_MATRIX[role]) as AcademicResource[]
  const permissions: Record<string, Action[]> = {}
  for (const resource of resources) {
    permissions[resource] = getAllowedActions(role, resource)
  }

  return successResponse({ role, permissions })
}
