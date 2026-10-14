/**
 * M1: per-person and per-place permission settings (UserPermissionOverride / LocationPermissionOverride). Server-only.
 * Only Super Admin manages them (like the Permissions page). The request-time side is lib/permission-context.ts.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_PERMISSION_MATRIX } from '@/lib/rbac'
import { forgetPermissionContext } from '@/lib/permission-context'

const RESOURCES = new Set(Object.keys(DEFAULT_PERMISSION_MATRIX.SUPER_ADMIN))
const STAFF_ROLES = ['ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY', 'MARKETING', 'TEACHER']
export const PLACE_ROLE_CHOICES = ['ALL', ...STAFF_ROLES]

export interface OverrideItem { resource: string; action: string; allowed: boolean }

function clean(items: OverrideItem[]): OverrideItem[] | string {
  const seen = new Set<string>()
  const out: OverrideItem[] = []
  for (const i of items) {
    if (!RESOURCES.has(i.resource)) return `Unknown permission: ${i.resource}`
    const k = `${i.resource}:${i.action}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(i)
  }
  return out
}

async function audit(userId: string, entityType: string, entityId: string, changes: unknown) {
  try {
    await prisma.auditLog.create({ data: { userId, action: 'UPDATE', entityType, entityId, changes: changes as Prisma.InputJsonValue } })
  } catch (err) {
    console.error('[PERMISSION_OVERRIDE_AUDIT]', err)
  }
}

export async function userOverrides(userId: string) {
  return prisma.userPermissionOverride.findMany({ where: { userId }, select: { resource: true, action: true, allowed: true }, orderBy: [{ resource: 'asc' }, { action: 'asc' }] })
}

/** Replaces all settings of one person. */
export async function saveUserOverrides(byUserId: string, userId: string, items: OverrideItem[]): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!u) return 'Account not found'
  if (u.role === 'SUPER_ADMIN') return 'Super Admin is not affected by these settings'
  if (['STUDENT', 'PARENT', 'GUARDIAN'].includes(u.role)) return 'Only staff accounts have their own permissions'
  const list = clean(items)
  if (typeof list === 'string') return list
  await prisma.$transaction([
    prisma.userPermissionOverride.deleteMany({ where: { userId } }),
    prisma.userPermissionOverride.createMany({ data: list.map((i) => ({ userId, ...i, createdById: byUserId })) }),
  ])
  forgetPermissionContext(userId)
  await audit(byUserId, 'UserPermissionOverride', userId, { items: list })
  return null
}

export async function placeOverrides(campusId: string) {
  return prisma.locationPermissionOverride.findMany({ where: { campusId }, select: { role: true, resource: true, action: true, allowed: true }, orderBy: [{ role: 'asc' }, { resource: 'asc' }, { action: 'asc' }] })
}

/** Replaces the settings of one place for one role (or ALL roles). */
export async function savePlaceOverrides(byUserId: string, campusId: string, role: string, items: OverrideItem[]): Promise<string | null> {
  if (!PLACE_ROLE_CHOICES.includes(role)) return 'Choose a staff role or all roles'
  if (!(await prisma.campus.count({ where: { id: campusId } }))) return 'Place not found'
  const list = clean(items)
  if (typeof list === 'string') return list
  await prisma.$transaction([
    prisma.locationPermissionOverride.deleteMany({ where: { campusId, role } }),
    prisma.locationPermissionOverride.createMany({ data: list.map((i) => ({ campusId, role, ...i, createdById: byUserId })) }),
  ])
  forgetPermissionContext(null)
  await audit(byUserId, 'LocationPermissionOverride', campusId, { role, items: list })
  return null
}
