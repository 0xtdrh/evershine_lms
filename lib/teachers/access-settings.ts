/**
 * Instructor access (2026-10-24, owner): an instructor sees only his groups' students; a FINISHED group (and its
 * students) stays visible for `finishedGroupDays` (final marks, late homework, last report), then it disappears.
 * Default 30, 0 = gone at once. Super Admin / Admin change it on the Staff page. Server-only.
 */

import { getSetting, setSetting } from '@/lib/settings/app-settings'

export interface TeacherAccessSettings { finishedGroupDays: number }
const KEY = 'teachers.access'
export const DEFAULT_TEACHER_ACCESS: TeacherAccessSettings = { finishedGroupDays: 30 }

export const clampDays = (n: unknown) => Math.min(365, Math.max(0, Math.round(Number(n) || 0)))
export async function getTeacherAccessSettings(): Promise<TeacherAccessSettings> {
  const v = await getSetting<TeacherAccessSettings>(KEY, DEFAULT_TEACHER_ACCESS)
  return { finishedGroupDays: clampDays(v.finishedGroupDays) }
}
export const saveTeacherAccessSettings = (v: TeacherAccessSettings, userId: string) => setSetting(KEY, { finishedGroupDays: clampDays(v.finishedGroupDays) }, userId)
