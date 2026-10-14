/**
 * M1 (2026-10-14): per-person and per-place permission settings for the current request. Server-only.
 *
 * WHY AsyncLocalStorage: checkPermission() is synchronous and is called with a role in ~500 places. auth() opens a
 * context for the request (synchronously, before its first await, so the route that awaits auth() keeps it) and fills it
 * once the session is known. checkPermission then reads the signed-in person's own settings from here (lib/rbac.ts).
 *
 * Order ("the most specific wins"): UserPermissionOverride > LocationPermissionOverride (the person's PRIMARY place,
 * their role first, then ALL roles) > Permissions page (role) > the code matrix. Super Admin is never affected.
 * Loaded at most every 30 s per person; a failure never blocks a request (the role rules apply).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { prisma } from '@/lib/prisma'
import { setPermissionContextProvider, type PermissionContext } from '@/lib/rbac'

interface Store { ctx?: PermissionContext }
const als = new AsyncLocalStorage<Store>()
setPermissionContextProvider(() => als.getStore()?.ctx)

const TTL_MS = 30_000
const cache = new Map<string, { at: number; ctx: PermissionContext }>()

/** Opens an empty context for this request. Call synchronously, before any await. */
export function beginPermissionContext(): Store {
  const store: Store = {}
  als.enterWith(store)
  return store
}

/** The primary place of a staff member (the campus on their role profile). */
async function primaryPlace(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      admin: { select: { campusId: true } }, branchManager: { select: { campusId: true } }, secretary: { select: { campusId: true } },
      marketingStaff: { select: { campusId: true } }, accountant: { select: { campusId: true } }, teacher: { select: { campusId: true } },
    },
  })
  if (!u) return null
  return u.admin?.campusId ?? u.branchManager?.campusId ?? u.secretary?.campusId ?? u.marketingStaff?.campusId ?? u.accountant?.campusId ?? u.teacher?.campusId ?? null
}

export async function loadPermissionContext(user: { id: string; role: string }): Promise<PermissionContext> {
  const hit = cache.get(user.id)
  if (hit && hit.ctx.role === user.role && Date.now() - hit.at < TTL_MS) return hit.ctx
  const ctx: PermissionContext = { role: user.role, user: new Map(), place: new Map() }
  if (user.role !== 'SUPER_ADMIN' && !['STUDENT', 'PARENT', 'GUARDIAN'].includes(user.role)) {
    const [own, campusId] = await Promise.all([
      prisma.userPermissionOverride.findMany({ where: { userId: user.id }, select: { resource: true, action: true, allowed: true } }),
      primaryPlace(user.id),
    ])
    for (const o of own) ctx.user.set(`${o.resource}:${o.action}`, o.allowed)
    if (campusId) {
      const rows = await prisma.locationPermissionOverride.findMany({ where: { campusId, role: { in: [user.role, 'ALL'] } }, select: { role: true, resource: true, action: true, allowed: true } })
      // the setting for the person's role wins over the one for ALL roles
      for (const r of rows.filter((x) => x.role === 'ALL')) ctx.place.set(`${r.resource}:${r.action}`, r.allowed)
      for (const r of rows.filter((x) => x.role !== 'ALL')) ctx.place.set(`${r.resource}:${r.action}`, r.allowed)
    }
  }
  cache.set(user.id, { at: Date.now(), ctx })
  return ctx
}

/** Fills the request's context once the session is known. Never throws. */
export async function fillPermissionContext(store: Store, user: { id: string; role: string }): Promise<void> {
  try {
    store.ctx = await loadPermissionContext(user)
  } catch (error) {
    console.error('[PERMISSION_CONTEXT_LOAD_FAILED]', error)
  }
}

/** Call after a person's or a place's settings change (null = everybody). */
export function forgetPermissionContext(userId: string | null = null) {
  if (userId) cache.delete(userId)
  else cache.clear()
}
