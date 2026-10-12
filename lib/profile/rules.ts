/**
 * P2 profile — pure rules (no database). docs/plan-learning-platform.md §5. Owner said «ابدأ» on 2026-10-12 without
 * answering the questions, so the proposed defaults are used and every one is a setting:
 * older students from 12, goals by student / parent / instructor, thank-you notes ON (instructor approves first),
 * videos up to 60 s / 50 MB, portfolio printed by staff only (parents can be allowed), the parent may add the skills
 * to the passport share link. Tests: tests/profile-rules.test.ts.
 */

import { z } from 'zod'

export interface ProfileSettings { olderAge: number; maxVideoSeconds: number; maxUploadMb: number; parentPortfolio: boolean; thanksOn: boolean; diaryOn: boolean; uploadsOn: boolean }
export const PROFILE_DEFAULTS: ProfileSettings = { olderAge: 12, maxVideoSeconds: 60, maxUploadMb: 50, parentPortfolio: false, thanksOn: true, diaryOn: true, uploadsOn: true }
export const profileSettingsSchema = z.object({
  olderAge: z.number().int().min(4).max(30), maxVideoSeconds: z.number().int().min(5).max(600), maxUploadMb: z.number().int().min(1).max(100),
  parentPortfolio: z.boolean(), thanksOn: z.boolean(), diaryOn: z.boolean(), uploadsOn: z.boolean(),
})

export function ageOn(dob: Date, now: Date): number {
  let a = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) a--
  return Math.max(0, a)
}

// ───────────────────────── goals ─────────────────────────

export const GOAL_METRICS = ['SESSIONS', 'STAMPS', 'HOMEWORK', 'QUIZ90', 'LEVEL'] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

export const goalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(['SYSTEM', 'FREE']),
  metric: z.enum(GOAL_METRICS).nullish(),
  target: z.number().int().min(1).max(10000).nullish(),
  levelId: z.string().nullish(),
  dueDate: z.string().nullish(),
}).refine((g) => g.kind === 'FREE' || !!g.metric, 'Choose what the system counts')
  .refine((g) => g.kind === 'FREE' || g.metric === 'LEVEL' || (g.target ?? 0) > 0, 'Type the number to reach')
  .refine((g) => g.metric !== 'LEVEL' || !!g.levelId, 'Choose the level')

/** Progress of a goal: SYSTEM = (now − baseline) / target; LEVEL = done or not; FREE = the hand-moved %. */
export function goalProgress(g: { kind: string; metric: string | null; target: number | null; baseline: number | null; progress: number }, current: number | null, levelDone = false) {
  if (g.kind === 'FREE') { const p = Math.max(0, Math.min(100, g.progress)); return { value: p, target: 100, percent: p, done: p >= 100 } }
  if (g.metric === 'LEVEL') return { value: levelDone ? 1 : 0, target: 1, percent: levelDone ? 100 : 0, done: levelDone }
  const target = Math.max(1, g.target ?? 1)
  const value = Math.max(0, (current ?? 0) - (g.baseline ?? 0))
  return { value: Math.min(value, target), target, percent: Math.min(100, Math.round((value / target) * 100)), done: value >= target }
}

// ───────────────────────── TechNova map ─────────────────────────

export type StationState = 'DONE' | 'CURRENT' | 'NEXT' | 'LATER'
export interface MapTrack { id: string; name: string; minAge: number | null; maxAge: number | null; courses: { id: string; name: string; order: number | null; levels: { id: string; name: string; order: number }[] }[] }

/**
 * Islands (tracks) with stations (levels): DONE / CURRENT / NEXT (the suggestion) / LATER, and the next step:
 * the level after the current or last finished one; then the next course of the track (track order); then a track that
 * fits the student's age and is not finished yet.
 */
export function buildMap(tracks: MapTrack[], passed: Set<string>, current: Set<string>, age: number | null) {
  const sortedCourses = (t: MapTrack) => [...t.courses].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name))
  const levels = (c: MapTrack['courses'][number]) => [...c.levels].sort((a, b) => a.order - b.order)
  const fits = (t: MapTrack) => age == null || ((t.minAge == null || age >= t.minAge) && (t.maxAge == null || age <= t.maxAge))
  let next: { levelId: string; label: string; reason: 'CONTINUE' | 'NEXT_COURSE' | 'NEW_TRACK' } | null = null
  // 1) continue a course the student is in / was in
  for (const t of tracks) for (const c of sortedCourses(t)) {
    const ls = levels(c)
    const lastTouched = ls.reduce((m, l, i) => (passed.has(l.id) || current.has(l.id) ? i : m), -1)
    if (lastTouched >= 0 && !current.has(ls[lastTouched].id) && lastTouched + 1 < ls.length && !next) next = { levelId: ls[lastTouched + 1].id, label: `${c.name} · ${ls[lastTouched + 1].name}`, reason: 'CONTINUE' }
  }
  // 2) the next course of a track where a course was finished
  if (!next && !current.size) {
    for (const t of tracks) {
      const cs = sortedCourses(t)
      const finishedIdx = cs.reduce((m, c, i) => { const ls = levels(c); return ls.length && passed.has(ls[ls.length - 1].id) ? i : m }, -1)
      if (finishedIdx < 0) continue
      const nc = cs.slice(finishedIdx + 1).find((c) => levels(c).length && !levels(c).some((l) => passed.has(l.id)))
      if (nc) { const l = levels(nc)[0]; next = { levelId: l.id, label: `${nc.name} · ${l.name}`, reason: 'NEXT_COURSE' }; break }
    }
  }
  // 3) a new track for the age
  if (!next && !current.size) {
    for (const t of tracks.filter(fits)) {
      const c = sortedCourses(t).find((x) => levels(x).length && !levels(x).some((l) => passed.has(l.id)))
      if (c) { const l = levels(c)[0]; next = { levelId: l.id, label: `${c.name} · ${l.name}`, reason: 'NEW_TRACK' }; break }
    }
  }
  return {
    next,
    islands: tracks.map((t) => ({
      id: t.id, name: t.name, ageFits: fits(t),
      courses: sortedCourses(t).map((c) => ({
        id: c.id, name: c.name,
        levels: levels(c).map((l) => ({ id: l.id, name: l.name, state: (passed.has(l.id) ? 'DONE' : current.has(l.id) ? 'CURRENT' : next?.levelId === l.id ? 'NEXT' : 'LATER') as StationState })),
      })),
    })),
  }
}

// ───────────────────────── uploads ─────────────────────────

export const PROFILE_UPLOAD_FORMATS = 'jpg,jpeg,png,webp,heic,mp4,mov,webm'
export interface UploadMedia { publicId: string; resourceType: 'image' | 'video'; format?: string; bytes?: number; duration?: number }

/** A project photo / video the uploader sent back after the signed upload. */
export function checkUpload(m: UploadMedia, folder: string, s: ProfileSettings): { ok: boolean; message?: string } {
  if (!m?.publicId || !m.publicId.startsWith(`${folder}/`)) return { ok: false, message: 'The file is not in the right place' }
  if (m.resourceType !== 'image' && m.resourceType !== 'video') return { ok: false, message: 'Only photos and videos' }
  if ((m.bytes ?? 0) > s.maxUploadMb * 1024 * 1024) return { ok: false, message: `The file is larger than ${s.maxUploadMb} MB` }
  if (m.resourceType === 'video' && (m.duration ?? 0) > s.maxVideoSeconds + 1) return { ok: false, message: `The video is longer than ${s.maxVideoSeconds} seconds` }
  return { ok: true }
}

export const EXPERIENCE_ROLES = ['ASSISTANT', 'AMBASSADOR', 'ALUMNI', 'OTHER'] as const

/** Is today inside the "year at TechNova" week (join anniversary − 0 … +6 days)? */
export function recapWeek(joinedAt: Date, now: Date): number | null {
  const years = now.getUTCFullYear() - joinedAt.getUTCFullYear()
  if (years < 1) return null
  const anniversary = Date.UTC(now.getUTCFullYear(), joinedAt.getUTCMonth(), joinedAt.getUTCDate())
  const diff = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - anniversary) / 86_400_000)
  return diff >= 0 && diff <= 6 ? years : null
}
