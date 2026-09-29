/**
 * One-time initial setup of TechNova's base data (owner decisions, 2026-09-29).
 * Run from /dashboard/admin/setup (Super Admin). Idempotent: every step checks
 * the current state first, so pressing it twice changes nothing the 2nd time.
 *
 *  1. Main branch: "Boys Campus" (template) -> "TechNova Company", HQ El Kawthar.
 *  2. Other branches (Girls Campus, test "فثسف") -> deactivated (soft delete:
 *     hidden everywhere, linked data kept).
 *  3. One batch "General" on the main branch (Batch is still required by
 *     groups/admission until Batch is removed).
 *  4. 5 tracks by age, each with ONE course of 6 levels:
 *     2 months, 8 sessions, monthly payment, 850 EGP.
 *  5. The internal academic year: active, unlocked, far end date (hidden from
 *     the UI; the code still needs one).
 */

import { prisma } from '@/lib/prisma'

export const MAIN_BRANCH = {
  name: 'TechNova Company',
  code: 'TN',
  address: 'الكوثر، الغردقة',
  templateCode: 'BC', // the template's "Boys Campus"
}

export const TRACKS = [
  { name: 'NovaExplorer', code: 'NOVA-EXPLORER', minAge: 4, maxAge: 7, description: 'Ages 4-7' },
  { name: 'NovaBuilders', code: 'NOVA-BUILDERS', minAge: 8, maxAge: 10, description: 'Ages 8-10' },
  { name: 'NovaEngineer', code: 'NOVA-ENGINEER', minAge: 11, maxAge: 14, description: 'Ages 11-14' },
  { name: 'NovaProfessional', code: 'NOVA-PROFESSIONAL', minAge: 15, maxAge: 18, description: 'Ages 15-18' },
  { name: 'NovaCareer', code: 'NOVA-CAREER', minAge: null, maxAge: null, description: 'University students' },
] as const

export const LEVEL_TEMPLATE = { count: 6, numberOfMonths: 2, numberOfSessions: 8, pricingType: 'MONTHLY' as const, monthlyPrice: 850 }

const FAR_FUTURE = new Date('2099-12-31T00:00:00Z')

export interface SetupStep {
  key: string
  title: string
  status: 'DONE' | 'TODO'
  detail: string
}

async function findMainBranch() {
  return (
    (await prisma.campus.findFirst({ where: { code: MAIN_BRANCH.code } })) ??
    (await prisma.campus.findFirst({ where: { code: MAIN_BRANCH.templateCode } }))
  )
}

export async function planInitialSetup(): Promise<SetupStep[]> {
  const steps: SetupStep[] = []
  const main = await findMainBranch()

  steps.push({
    key: 'main-branch',
    title: 'Main branch: TechNova Company (El Kawthar)',
    status: main && main.name === MAIN_BRANCH.name && main.code === MAIN_BRANCH.code ? 'DONE' : 'TODO',
    detail: main ? `Currently "${main.name}" (${main.code}). Students and groups on it stay as they are.` : 'No main branch found — it will be created.',
  })

  const others = await prisma.campus.findMany({
    where: { isActive: true, ...(main ? { id: { not: main.id } } : {}) },
    select: { name: true, code: true },
  })
  steps.push({
    key: 'other-branches',
    title: 'Deactivate the other branches',
    status: others.length === 0 ? 'DONE' : 'TODO',
    detail: others.length
      ? `Will deactivate: ${others.map((c) => `"${c.name}" (${c.code})`).join(', ')}. Hidden everywhere; their data is kept.`
      : 'Only the main branch is active.',
  })

  const batch = main ? await prisma.batch.findFirst({ where: { campusId: main.id, name: 'General' } }) : null
  steps.push({
    key: 'batch',
    title: 'One batch: "General"',
    status: batch ? 'DONE' : 'TODO',
    detail: batch ? 'Exists.' : 'Will be created on the main branch.',
  })

  for (const t of TRACKS) {
    const track = await prisma.track.findUnique({ where: { name: t.name } })
    const course = await prisma.academicSubject.findUnique({ where: { code: t.code } })
    const levels = course ? await prisma.level.count({ where: { subjectId: course.id } }) : 0
    steps.push({
      key: `track-${t.code}`,
      title: `${t.name} (${t.description}) — 1 course, ${LEVEL_TEMPLATE.count} levels`,
      status: track && course && levels >= LEVEL_TEMPLATE.count ? 'DONE' : 'TODO',
      detail: `${LEVEL_TEMPLATE.numberOfMonths} months, ${LEVEL_TEMPLATE.numberOfSessions} sessions, monthly ${LEVEL_TEMPLATE.monthlyPrice} EGP per level. Now: ${track ? 'track ✓' : 'no track'}, ${course ? 'course ✓' : 'no course'}, ${levels} level(s).`,
    })
  }

  const year = await prisma.academicYear.findFirst({ where: { isActive: true } })
  steps.push({
    key: 'year',
    title: 'Internal year (hidden from screens)',
    status: year && !year.isLocked && year.endDate >= FAR_FUTURE ? 'DONE' : 'TODO',
    detail: year ? `Using "${year.name}" internally; it will be kept unlocked and never expire.` : 'A default internal year will be created.',
  })

  return steps
}

export async function applyInitialSetup(): Promise<SetupStep[]> {
  // 1. Main branch
  let main = await findMainBranch()
  if (!main) {
    main = await prisma.campus.create({
      data: { name: MAIN_BRANCH.name, code: MAIN_BRANCH.code, address: MAIN_BRANCH.address, phone: '-', email: '-', principalName: '-' },
    })
  } else if (main.name !== MAIN_BRANCH.name || main.code !== MAIN_BRANCH.code || !main.isActive) {
    main = await prisma.campus.update({
      where: { id: main.id },
      data: { name: MAIN_BRANCH.name, code: MAIN_BRANCH.code, address: MAIN_BRANCH.address, isActive: true },
    })
  }

  // 2. Other branches -> inactive (soft)
  await prisma.campus.updateMany({ where: { isActive: true, id: { not: main.id } }, data: { isActive: false } })

  // 3. Batch "General"
  await prisma.batch.upsert({
    where: { name_campusId: { name: 'General', campusId: main.id } },
    update: { isActive: true },
    create: { name: 'General', code: 'GEN', campusId: main.id, academicLevel: 'All', description: 'Default batch' },
  })

  // 4. Tracks -> course -> 6 levels
  for (const t of TRACKS) {
    const track = await prisma.track.upsert({
      where: { name: t.name },
      update: { minAge: t.minAge, maxAge: t.maxAge, description: t.description, isActive: true },
      create: { name: t.name, minAge: t.minAge, maxAge: t.maxAge, description: t.description },
    })
    const course = await prisma.academicSubject.upsert({
      where: { code: t.code },
      update: { name: t.name, trackId: track.id, trackOrder: 1, isActive: true },
      create: { name: t.name, code: t.code, trackId: track.id, trackOrder: 1, description: t.description },
    })
    for (let order = 1; order <= LEVEL_TEMPLATE.count; order++) {
      await prisma.level.upsert({
        where: { subjectId_order: { subjectId: course.id, order } },
        update: {},
        create: {
          subjectId: course.id,
          name: `Level ${order}`,
          order,
          numberOfMonths: LEVEL_TEMPLATE.numberOfMonths,
          numberOfSessions: LEVEL_TEMPLATE.numberOfSessions,
          pricingType: LEVEL_TEMPLATE.pricingType,
          monthlyPrice: LEVEL_TEMPLATE.monthlyPrice,
        },
      })
    }
  }

  // 5. Internal year
  await ensureInternalYear()

  return planInitialSetup()
}

/** The code needs an active academic year; TechNova does not use one. Keep one quietly. */
export async function ensureInternalYear() {
  const active = await prisma.academicYear.findFirst({ where: { isActive: true } })
  if (active) {
    if (active.isLocked || active.endDate < FAR_FUTURE) {
      return prisma.academicYear.update({ where: { id: active.id }, data: { isLocked: false, endDate: FAR_FUTURE } })
    }
    return active
  }
  const existing = await prisma.academicYear.findFirst({ orderBy: { startDate: 'desc' } })
  if (existing) {
    return prisma.academicYear.update({ where: { id: existing.id }, data: { isActive: true, isLocked: false, endDate: FAR_FUTURE } })
  }
  return prisma.academicYear.create({
    data: { name: 'TechNova', startDate: new Date('2024-01-01T00:00:00Z'), endDate: FAR_FUTURE, isActive: true },
  })
}
