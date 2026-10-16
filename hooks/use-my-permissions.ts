'use client'

/**
 * The signed-in person's effective permissions (role matrix + Permissions page + place / personal overrides),
 * from /api/me/permissions — same cache as the sidebar. `can(resource, action)` is false while loading.
 */

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import type { AcademicResource, Action } from '@/lib/rbac'

export function useMyPermissions() {
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const { data, isLoading } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    enabled: !!role,
    staleTime: 60_000,
  })
  const can = (r: AcademicResource, a: Action) => !!data?.permissions?.[r]?.includes(a)
  return { role, can, ready: !!data && !isLoading }
}
