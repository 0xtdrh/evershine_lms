/**
 * Phase C birthdays — students, parents and staff (docs/design-phase-c.md).
 *  - all dates in Egypt time; a 29 February birthday is celebrated on 28 Feb in non-leap years
 *  - daily job (lib/jobs/daily.ts): portal notification to the student and the
 *    parents (many students have no e-mail), WhatsApp too once the Cloud API is
 *    set; instructors and branch staff get "birthdays today"; one greeting per
 *    person per year (BirthdayGreeting); optional birthday discount
 *    (Discounts → rules → birthdayTypeId)
 *  - parents and non-teacher staff: User.dateOfBirth (optional); teachers and students: their own record
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cairoYmd, daysUntilBirthday, ageOn, addDays, type Ymd } from '@/lib/dates/cairo'
import { notifyFamilies, notifyUsers, branchStaffUserIds, isEventOn } from '@/lib/notifications/events'
import { isAutoWhatsAppConfigured, sendWhatsAppText } from '@/lib/messaging/whatsapp'
import { getDiscountRules } from '@/lib/discounts/engine'

export type PersonKind = 'STUDENT' | 'GUARDIAN' | 'STAFF'
export interface BirthdayPerson {
  kind: PersonKind
  id: string
  userId: string | null
  name: string
  role: string | null
  dateOfBirth: string
  daysAway: number
  turns: number
  campusId: string | null
  campus: string | null
  phone: string | null
  groups: { id: string; label: string }[]
  children: string[]
}

const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING'] as const

export async function birthdayPeople(opts: { from?: Ymd; days: number; kinds?: PersonKind[]; campusId?: string | null; groupIds?: string[] | null }): Promise<BirthdayPerson[]> {
  const from = opts.from ?? cairoYmd()
  const kinds = opts.kinds ?? ['STUDENT', 'GUARDIAN', 'STAFF']
  const campuses = new Map((await prisma.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]))
  const out: BirthdayPerson[] = []
  const push = (p: Omit<BirthdayPerson, 'daysAway' | 'turns' | 'dateOfBirth'> & { dob: Date }) => {
    const away = daysUntilBirthday(p.dob, from, opts.days)
    if (away == null) return
    const day = addDays(from, away)
    const { dob, ...rest } = p
    out.push({ ...rest, dateOfBirth: dob.toISOString().slice(0, 10), daysAway: away, turns: ageOn(dob, day) })
  }

  // Students in active groups (or all active students of the branch when no group filter)
  if (kinds.includes('STUDENT') || kinds.includes('GUARDIAN')) {
    const students = await prisma.student.findMany({
      where: {
        isActive: true,
        ...(opts.campusId && { campusId: opts.campusId }),
        ...(opts.groupIds && { enrollments: { some: { classSectionId: { in: opts.groupIds }, status: 'ACTIVE' } } }),
      },
      select: {
        id: true, userId: true, firstName: true, lastName: true, dateOfBirth: true, campusId: true, phoneNumber: true,
        enrollments: { where: { status: 'ACTIVE', classSection: { status: 'ACTIVE' } }, select: { classSection: { select: { id: true, className: true, sectionName: true } } } },
        guardians: { select: { id: true, userId: true, firstName: true, lastName: true, phoneNumber: true, user: { select: { dateOfBirth: true } } } },
      },
    })
    const guardiansSeen = new Map<string, BirthdayPerson | null>()
    for (const s of students) {
      const groups = s.enrollments.map((e) => ({ id: e.classSection.id, label: `${e.classSection.className} ${e.classSection.sectionName}`.trim() }))
      if (kinds.includes('STUDENT') && s.dateOfBirth) {
        push({ kind: 'STUDENT', id: s.id, userId: s.userId, name: `${s.firstName} ${s.lastName}`, role: null, dob: s.dateOfBirth, campusId: s.campusId, campus: campuses.get(s.campusId) ?? null, phone: s.guardians[0]?.phoneNumber ?? s.phoneNumber, groups, children: [] })
      }
      if (kinds.includes('GUARDIAN')) {
        for (const g of s.guardians) {
          if (!g.user?.dateOfBirth) continue
          const seen = out.find((p) => p.kind === 'GUARDIAN' && p.id === g.id)
          if (seen) { seen.children.push(s.firstName); continue }
          if (guardiansSeen.has(g.id)) continue
          guardiansSeen.set(g.id, null)
          push({ kind: 'GUARDIAN', id: g.id, userId: g.userId, name: `${g.firstName} ${g.lastName}`.trim(), role: 'Parent', dob: g.user.dateOfBirth, campusId: s.campusId, campus: campuses.get(s.campusId) ?? null, phone: g.phoneNumber, groups: [], children: [s.firstName] })
        }
      }
    }
  }

  if (kinds.includes('STAFF') && !opts.groupIds) {
    const teachers = await prisma.teacher.findMany({
      where: { isActive: true, ...(opts.campusId && { campusId: opts.campusId }), user: { isActive: true } },
      select: { id: true, userId: true, firstName: true, lastName: true, dateOfBirth: true, campusId: true, phoneNumber: true },
    })
    for (const t of teachers) if (t.dateOfBirth) push({ kind: 'STAFF', id: t.userId, userId: t.userId, name: `${t.firstName} ${t.lastName}`, role: 'Instructor', dob: t.dateOfBirth, campusId: t.campusId, campus: campuses.get(t.campusId) ?? null, phone: t.phoneNumber, groups: [], children: [] })
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: [...STAFF_ROLES] }, dateOfBirth: { not: null } },
      select: {
        id: true, role: true, dateOfBirth: true, displayName: true, email: true,
        admin: { select: { firstName: true, lastName: true, campusId: true } },
        secretary: { select: { firstName: true, lastName: true, campusId: true, phoneNumber: true } },
        accountant: { select: { firstName: true, lastName: true, campusId: true, phoneNumber: true } },
        branchManager: { select: { firstName: true, lastName: true, campusId: true } },
        marketingStaff: { select: { firstName: true, lastName: true, campusId: true, phoneNumber: true } },
      },
    })
    for (const u of users) {
      const p = u.admin ?? u.secretary ?? u.accountant ?? u.branchManager ?? u.marketingStaff
      const campusId = p?.campusId ?? null
      if (opts.campusId && campusId && campusId !== opts.campusId) continue
      const phone = (u.secretary?.phoneNumber ?? u.accountant?.phoneNumber ?? u.marketingStaff?.phoneNumber) || null
      push({ kind: 'STAFF', id: u.id, userId: u.id, name: p ? `${p.firstName} ${p.lastName}` : u.displayName ?? u.email, role: u.role.replace('_', ' ').toLowerCase(), dob: u.dateOfBirth!, campusId, campus: campusId ? campuses.get(campusId) ?? null : null, phone, groups: [], children: [] })
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name))
}

export const birthdayText = (name: string) => `Happy birthday ${name}! 🎂🎉 Everyone at TechNova wishes you a wonderful year full of joy, learning and new inventions.`

/** Today's greetings; safe to run more than once a day (one greeting per person per year). */
export async function runBirthdayJob(now: Date = new Date()) {
  const today = cairoYmd(now)
  const people = await birthdayPeople({ from: today, days: 0 })
  const done = await prisma.birthdayGreeting.findMany({ where: { year: today.y }, select: { personType: true, personId: true } })
  const doneKeys = new Set(done.map((d) => `${d.personType}|${d.personId}`))
  const todo = people.filter((p) => !doneKeys.has(`${p.kind}|${p.id}`))
  let greeted = 0
  const byCampus = new Map<string, string[]>()
  const byTeacherUser = new Map<string, string[]>()
  const rules = await getDiscountRules()
  const bdayType = rules.birthdayTypeId ? await prisma.discountType.findUnique({ where: { id: rules.birthdayTypeId } }) : null

  for (const p of todo) {
    try {
      await prisma.birthdayGreeting.create({ data: { personType: p.kind, personId: p.id, year: today.y } })
    } catch {
      continue // another run greeted them a moment ago
    }
    greeted++
    const first = p.name.split(' ')[0]
    if (p.kind === 'STUDENT') {
      await notifyFamilies([p.id], 'BIRTHDAY', () => ({ title: `Happy birthday ${first}! 🎂`, message: `${birthdayText(first)} Your birthday certificate is ready in the portal.`, relatedId: p.id }), { includeStudent: true })
      if (bdayType?.isActive) {
        try {
          await prisma.discountAssignment.create({
            data: { discountTypeId: bdayType.id, studentId: p.id, value: bdayType.value, status: 'ACTIVE', reason: `Birthday ${today.y}`, requestedById: 'system', approvedById: 'system', approvedAt: new Date() },
          })
        } catch (err) {
          console.error('[BIRTHDAY_DISCOUNT]', err)
        }
      }
      const label = `${p.name} (${p.groups.map((g) => g.label).join(', ') || 'no group'}) turns ${p.turns}`
      if (p.campusId) byCampus.set(p.campusId, [...(byCampus.get(p.campusId) ?? []), label])
      if (p.groups.length) {
        const offerings = await prisma.subjectOffering.findMany({ where: { classSectionId: { in: p.groups.map((g) => g.id) }, teacherId: { not: null } }, select: { teacher: { select: { userId: true } } } })
        for (const o of offerings) if (o.teacher?.userId) byTeacherUser.set(o.teacher.userId, [...new Set([...(byTeacherUser.get(o.teacher.userId) ?? []), label])])
      }
    } else {
      await notifyUsers([p.userId], 'BIRTHDAY', { title: `Happy birthday ${first}! 🎂`, message: birthdayText(first), relatedId: null })
      if (p.phone && isAutoWhatsAppConfigured() && (await isEventOn('BIRTHDAY'))) await sendWhatsAppText(p.phone, birthdayText(first))
      if (p.kind === 'STAFF') {
        const colleagues = (await branchStaffUserIds(p.campusId)).filter((id) => id !== p.userId)
        await notifyUsers(colleagues, 'BIRTHDAY_STAFF', { title: 'Colleague birthday today 🎂', message: `Today is ${p.name}'s birthday (${p.role ?? 'staff'}).`, relatedId: null })
      }
    }
  }
  for (const [campusId, list] of byCampus) {
    await notifyUsers(await branchStaffUserIds(campusId), 'BIRTHDAY_STAFF', { title: 'Student birthdays today 🎂', message: list.join('\n'), relatedId: null })
  }
  for (const [userId, list] of byTeacherUser) {
    await notifyUsers([userId], 'BIRTHDAY_STAFF', { title: 'Birthdays in your groups today 🎂', message: list.join('\n'), relatedId: null })
  }
  return { date: `${today.y}-${today.m}-${today.d}`, people: people.length, greeted }
}
