/**
 * Where /dashboard/attendance sends each role (final test 18/11): every staff role and instructor → the group attendance
 * screen; branch managers, secretaries and accountants used to land on the old template roster (all English).
 */
export function attendanceTarget(role: string | undefined | null): string | null {
  if (!role) return null
  if (role === 'STUDENT') return '/dashboard/learning'
  if (role === 'PARENT' || role === 'GUARDIAN') return '/dashboard/my-children'
  return '/dashboard/attendance/sections'
}
