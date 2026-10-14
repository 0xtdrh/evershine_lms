/**
 * Test stand-in for '@/lib/places/server' (M0 places): the person's places come from the mocked `auth()` user
 * (super admin / no campus = every place, otherwise their campus). The pure rules stay real. Use with
 * `vi.mock('@/lib/places/server', () => import('./helpers/places-mock'))`.
 */
import * as rules from '@/lib/places/rules'
import { auth } from '@/lib/auth'

export * from '@/lib/places/rules'
export const PLACE_COOKIE = 'tn_place'

export async function loadPlaces(): Promise<rules.Places> {
  const u = (await auth())?.user as { role?: string; campusId?: string | null } | undefined
  return rules.resolvePlaces({ role: u?.role ?? '', allLocations: false, primary: u?.campusId ?? null, extra: [], groups: [] })
}
export const requestPlaces = loadPlaces
export const forgetPlaces = () => {}
export const canSeeGroup = async () => true
export const canSeeStudent = async () => true
export const canSeeInvoice = async () => true
export const canSeeTeacher = async () => true
export const canSeeUser = async () => true
export const visibleUserIds = async () => null
export const visibleStudentIds = async (p: rules.Places) => (p.all ? null : [])
