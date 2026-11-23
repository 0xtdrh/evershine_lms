/**
 * Six phases 1-B (2026-11-13): a family books a course from its account (server only).
 *
 * book()     checks the child, the course (age / opened / code), the way (live online / recorded / branch) and the group,
 *            takes the code, then by the confirm rule (lib/bookings/rules.ts resolveRule):
 *              AUTO  → place() at once: real Student (TN/YYYY/NNNN) the first time, code → approved discount, join the group
 *                      (full → waiting list) or the recorded course, first invoice; seat HELD until it is paid;
 *              STAFF → REVIEW until staff approve (decide()).
 * syncBookings() HOLD → CONFIRMED when the first invoice is paid; past the hold with nothing paid → EXPIRED
 *            (enrolment withdrawn, invoice cancelled, seat freed). Runs lazily (30 s) + in the daily job.
 * Every rule of the existing flows applies because they are called as they are (enrolment, invoices, discounts, waiting list).
 */

import { hash } from '@node-rs/argon2'
import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { publicCatalog, type PublicCourse } from '@/lib/site/courses-store'
import { cyclePrice } from '@/lib/pricing/group-price'
import { effectiveModes } from '@/lib/delivery/modes'
import { groupSeats, notifySeatFreed, waitForGroup, withSeatLock } from '@/lib/groups/capacity'
import { resolveBatchId } from '@/lib/batches/default-batch'
import { nextRegistrationNumber } from '@/lib/ids/sequence'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { createYearEnrollmentForStudent } from '@/lib/academic/enrollment'
import { notifyUsers } from '@/lib/notifications/events'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { applyCodeToStudent, lookupCode, useCode } from '@/lib/site/codes-store'
import { normalizeCode, PROBLEM_TEXT } from '@/lib/site/codes'
import { coursesFor, familyOf, type FamilyPerson } from '@/lib/accounts/engine'
import { canBook } from '@/lib/accounts/rules'
import { holdExpired, invoicePaid, OPEN_STATUSES, resolveRule, STATUS_TEXT, type BookInput, type BookingStatus, type CodeTarget } from './rules'

const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4, outputLen: 32 }

export class BookingError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

type Guardian = { id: string; userId: string; firstName: string; lastName: string; phoneNumber: string; city: string | null; partnerId?: string | null }

// ── what can be booked ───────────────────────────────────────────────────────

async function courseLevels(c: PublicCourse) {
  const rows = await prisma.level.findMany({
    where: { subjectId: { in: c.courseIds }, isActive: true },
    select: { id: true, name: true, order: true, subjectId: true, pricingType: true, monthlyPrice: true, fullLevelPrice: true, allowedModes: true, subject: { select: { name: true, allowedModes: true, track: { select: { allowedModes: true } } } } },
  })
  return rows.sort((a, b) => c.courseIds.indexOf(a.subjectId) - c.courseIds.indexOf(b.subjectId) || a.order - b.order)
}

async function codeFor(raw: string | null | undefined, c: PublicCourse, phone: string, extra: Omit<CodeTarget, 'listing' | 'trackId' | 'courseIds'> = {}) {
  if (!raw?.trim()) return null
  const target: CodeTarget = { listing: c.slug, trackId: c.trackId, courseIds: c.courseIds, ...extra }
  return lookupCode(raw, c.slug, phone, target)
}

/** Everything a family needs to choose: the starting level, the online / branch groups with details, the recorded plans. */
export async function bookingOptions(guardian: Guardian, personKey: string, slug: string, rawCode?: string | null, linkGroupId?: string | null) {
  const person = (await familyOf(guardian.id)).find((p) => p.key === personKey)
  if (!person) throw new BookingError('NOT_FOUND', 'Not in your family · مش في عيلتك', 404)
  const { courses } = await coursesFor(guardian.id, person)
  const c = courses.find((x) => x.slug === slug) ?? (await publicCatalog({ slug }))[0]
  if (!c) throw new BookingError('NOT_FOUND', 'This course is not open for booking · الكورس ده مش متاح للحجز', 404)
  const fit = 'fit' in c ? (c as { fit: Parameters<typeof canBook>[0] }).fit : 'TOO_YOUNG'
  // a code for chosen levels / groups is checked against this course's levels / groups (the group is chosen later)
  const peek = rawCode?.trim() ? await prisma.enrolmentCode.findUnique({ where: { code: normalizeCode(rawCode) }, select: { scope: true, scopeIds: true } }) : null
  const peekIds = Array.isArray(peek?.scopeIds) ? (peek!.scopeIds as unknown[]).map(String) : []
  const codeGroups = peek?.scope === 'GROUP'
    ? await prisma.classSection.findMany({ where: { id: { in: peekIds }, status: 'ACTIVE', isActive: true, level: { subjectId: { in: c.courseIds } } }, select: { id: true, levelId: true } })
    : []
  const codeLevel = peek?.scope === 'LEVEL' ? (await prisma.level.findFirst({ where: { id: { in: peekIds }, subjectId: { in: c.courseIds } }, select: { id: true } }))?.id ?? null : null
  const code = await codeFor(rawCode, c, guardian.phoneNumber, { groupId: codeGroups[0]?.id ?? null, levelId: codeLevel ?? codeGroups[0]?.levelId ?? null })
  if (code && !code.res.ok) throw new BookingError('BAD_CODE', `${PROBLEM_TEXT[code.res.problem!].en} · ${PROBLEM_TEXT[code.res.problem!].ar}`)
  if (fit === 'ENROLLED') throw new BookingError('ENROLLED', 'Already learning this course · بيتعلم الكورس ده بالفعل', 409)
  if (!canBook(fit) && !code?.row?.unlocks) throw new BookingError('NOT_SUITABLE', 'This course does not suit the age. Ask TechNova to open it · الكورس ده مش مناسب للسن. اطلب من TechNova تفتحه', 403)

  const levels = await courseLevels(c)
  // a group's booking link / QR: that group (and its level), even in a partner's place
  const linkGroup = linkGroupId ? await prisma.classSection.findFirst({ where: { id: linkGroupId, status: 'ACTIVE', isActive: true, kind: 'GROUP', levelId: { in: levels.map((l) => l.id) } }, select: { id: true, levelId: true, campusId: true } }) : null
  const level = levels.find((l) => l.id === (linkGroup?.levelId ?? codeGroups[0]?.levelId ?? codeLevel ?? code?.row?.startLevelId)) ?? levels[0]
  if (!level) throw new BookingError('NOT_FOUND', 'This course has no level yet · الكورس ده لسه مالوش مستوى', 404)
  const modes = effectiveModes({ level: level.allowedModes, course: level.subject?.allowedModes, track: level.subject?.track?.allowedModes }).modes

  const groups = await prisma.classSection.findMany({
    where: {
      levelId: level.id, status: 'ACTIVE', isActive: true, kind: 'GROUP',
      OR: [
        { campus: { isActive: true, kind: { in: ['MAIN', 'ONLINE'] } } },
        ...(guardian.partnerId ? [{ campus: { isActive: true, kind: 'PARTNER', partnerId: guardian.partnerId } }] : []),
        ...(linkGroup ? [{ id: linkGroup.id }] : []),
      ],
    },
    select: { id: true, className: true, sectionName: true, scheduleSlots: true, startDate: true, priceOverride: true, installmentsAllowed: true, campus: { select: { id: true, name: true, kind: true } } },
    take: 60,
  })
  const shaped = await Promise.all(groups.filter((g) => !codeGroups.length || codeGroups.some((x) => x.id === g.id)).map(async (g) => {
    const seats = await groupSeats(g.id)
    const slots = Array.isArray(g.scheduleSlots) ? (g.scheduleSlots as { dayOfWeek: number; time: string }[]).filter((x) => typeof x?.dayOfWeek === 'number' && typeof x?.time === 'string').map((x) => ({ dayOfWeek: x.dayOfWeek, time: x.time })) : []
    return {
      id: g.id, name: [g.className, g.sectionName].filter(Boolean).join(' '), campusId: g.campus.id, campusName: g.campus.name, online: g.campus.kind === 'ONLINE',
      slots, startDate: g.startDate ? g.startDate.toISOString().slice(0, 10) : null, free: seats.free, full: seats.full,
      price: await cyclePrice(level, g.campus.id, g.priceOverride), installments: g.installmentsAllowed,
    }
  }))
  const branches = await prisma.campus.findMany({
    where: { isActive: true, OR: [{ kind: 'MAIN' }, ...(guardian.partnerId ? [{ kind: 'PARTNER', partnerId: guardian.partnerId }] : []), ...(linkGroup ? [{ id: linkGroup.campusId }] : [])], NOT: { kind: 'ONLINE' } },
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  })
  const settings = await (await import('@/lib/accounts/engine')).getAccountsSettings()
  const recorded = modes.includes('RECORDED') ? await prisma.recordedCourse.findFirst({ where: { levelId: level.id, isActive: true } }) : null
  return {
    person: { key: person.key, firstName: person.firstName, age: person.age },
    course: { slug: c.slug, title: c.title, trackId: c.trackId, refType: c.refType },
    /** a full track for a child who may have learned before: ask, and let TechNova set the level */
    askExperience: c.refType === 'TRACK' && settings.askExperience && levels.length > 1 && !linkGroup && !code?.row?.startLevelId && !codeGroups.length && !codeLevel,
    link: linkGroup ? { groupId: linkGroup.id, online: shaped.find((g) => g.id === linkGroup.id)?.online ?? false, campusId: linkGroup.campusId } : null,
    level: { id: level.id, name: level.name, course: level.subject?.name ?? '', perMonth: level.pricingType === 'MONTHLY' },
    code: code?.row ? { code: code.code, kind: code.row.kind, value: code.row.value } : null,
    online: modes.includes('ONLINE') ? shaped.filter((g) => g.online) : null,
    branch: modes.includes('BRANCH') ? branches.map((b) => ({ ...b, groups: shaped.filter((g) => !g.online && g.campusId === b.id) })) : null,
    recorded: recorded ? {
      plans: [
        ...(recorded.oneTimePrice != null ? [{ plan: 'ONE_TIME' as const, price: Number(recorded.oneTimePrice), days: null as number | null }] : []),
        ...(recorded.subscriptionPrice != null && recorded.subscriptionDays ? [{ plan: 'SUBSCRIPTION' as const, price: Number(recorded.subscriptionPrice), days: recorded.subscriptionDays }] : []),
      ],
    } : null,
  }
}

// ── booking ──────────────────────────────────────────────────────────────────

export async function onlineCampusId() {
  return (await prisma.campus.findFirst({ where: { kind: 'ONLINE', isActive: true }, select: { id: true } }))?.id ?? null
}

export async function book(guardian: Guardian, v: BookInput) {
  const opts = await bookingOptions(guardian, v.person, v.slug, v.code, v.link)
  const person = (await familyOf(guardian.id)).find((p) => p.key === v.person)!
  let campusId: string | null = null
  let groupId: string | null = null
  const placement = v.experience === 'BEFORE' && opts.askExperience
  if (v.mode === 'RECORDED') {
    if (!opts.recorded) throw new BookingError('NO_WAY', 'This course is not offered recorded · الكورس ده مش متاح مسجل')
    if (!placement && !opts.recorded.plans.some((p) => p.plan === v.plan)) throw new BookingError('NO_PLAN', 'Choose a plan · اختار النظام')
    campusId = await onlineCampusId()
    if (!campusId) throw new BookingError('NO_WAY', 'Online learning is not set up yet · التعلم أونلاين لسه مش جاهز')
  } else {
    const list = v.mode === 'ONLINE' ? opts.online : opts.branch?.flatMap((b) => b.groups) ?? null
    if (!list) throw new BookingError('NO_WAY', v.mode === 'ONLINE' ? 'Live online is not offered for this course · اللايف أونلاين مش متاح للكورس ده' : 'Branches do not offer this course · الفروع مش بتقدم الكورس ده')
    if (v.groupId && !placement) {
      const g = list.find((x) => x.id === v.groupId)
      if (!g) throw new BookingError('NO_GROUP', 'This group is not available · الجروب ده مش متاح')
      groupId = g.id
      campusId = g.campusId
    } else {
      campusId = v.mode === 'ONLINE' ? await onlineCampusId() : opts.branch?.find((b) => b.id === v.campusId)?.id ?? null
      if (!campusId) throw new BookingError('NO_PLACE', 'Choose a branch · اختار الفرع')
    }
  }
  const open = await prisma.courseBooking.findFirst({
    where: { guardianId: guardian.id, listingSlug: v.slug, status: { in: OPEN_STATUSES }, OR: [...(person.memberId ? [{ memberId: person.memberId }] : []), ...(person.studentId ? [{ studentId: person.studentId }] : [])] },
    select: { id: true },
  })
  if (open) throw new BookingError('ALREADY', 'There is already a booking for this course · فيه حجز للكورس ده بالفعل', 409)
  if (person.studentId && groupId && (await prisma.studentEnrollment.count({ where: { studentId: person.studentId, classSectionId: groupId, status: 'ACTIVE' } }))) {
    throw new BookingError('ALREADY', 'Already in this group · موجود في الجروب ده بالفعل', 409)
  }

  // the code: checked again for this group, one use taken now
  let code: string | null = null
  if (v.code?.trim()) {
    const c = (await publicCatalog({ slug: v.slug }))[0]!
    const chk = await codeFor(v.code, c, guardian.phoneNumber, { levelId: opts.level.id, groupId })
    if (!chk?.res.ok) throw new BookingError('BAD_CODE', chk ? `${PROBLEM_TEXT[chk.res.problem!].en} · ${PROBLEM_TEXT[chk.res.problem!].ar}` : 'Bad code')
    code = chk.code
  }

  const level = await prisma.level.findUnique({ where: { id: opts.level.id }, select: { subjectId: true } })
  const rule = resolveRule(await prisma.bookingRule.findMany(), { campusId, trackId: opts.course.trackId, courseId: level?.subjectId, levelId: opts.level.id, groupId })
  const row = await prisma.courseBooking.create({
    data: {
      guardianId: guardian.id, memberId: person.memberId, studentId: person.studentId, listingSlug: v.slug, levelId: opts.level.id, mode: v.mode, plan: v.plan ?? null,
      campusId, classSectionId: groupId, code, status: placement ? 'PLACEMENT' : rule.confirm === 'STAFF' ? 'REVIEW' : 'HOLD', createdById: guardian.userId,
      source: v.link && groupId === v.link ? 'GROUP_LINK' : guardian.partnerId ? 'PARTNER' : null,
    },
  })
  if (code) {
    const codeRow = await prisma.enrolmentCode.findUnique({ where: { code }, select: { id: true } })
    if (codeRow && !(await useCode(codeRow.id, guardian.phoneNumber, null))) {
      await prisma.courseBooking.update({ where: { id: row.id }, data: { status: 'CANCELLED', reason: 'code ran out' } })
      throw new BookingError('BAD_CODE', `${PROBLEM_TEXT.USED_UP.en} · ${PROBLEM_TEXT.USED_UP.ar}`)
    }
  }
  await tellStaff(row.id, guardian, person, opts.course.title, v.mode, rule.confirm === 'STAFF' || placement)
  if (rule.confirm === 'STAFF' || placement) return bookingView(row.id)
  await place(row.id, guardian.userId, rule.holdHours)
  return bookingView(row.id)
}

/** Makes the real student the first time a child is booked (same fields an approved admission makes). */
async function studentFor(person: FamilyPerson, guardian: Guardian, campusId: string, online: boolean): Promise<string> {
  if (person.studentId) return person.studentId
  const m = await prisma.familyMember.findUnique({ where: { id: person.memberId! } })
  if (!m) throw new BookingError('NOT_FOUND', 'Child not found', 404)
  if (m.studentId) return m.studentId
  const reg = await nextRegistrationNumber()
  const passwordHash = await hash(reg.replace(/\//g, ''), ARGON2_OPTIONS)
  const year = Number(cairoToday().slice(0, 4))
  const batchId = await resolveBatchId(campusId, null)
  const student = await prisma.$transaction(async (tx) => {
    let email = `${reg.replace(/\//g, '').toLowerCase()}@students.technova.local`
    if (await tx.user.findUnique({ where: { email } })) email = `${reg.replace(/\//g, '').toLowerCase()}.${Date.now()}@students.technova.local`
    const user = await tx.user.create({ data: { email, passwordHash, role: 'STUDENT', isActive: true } })
    const s = await tx.student.create({
      data: {
        userId: user.id, registrationNumber: reg, admissionNumber: reg, firstName: m.firstName, lastName: m.lastName,
        fatherName: m.isSelf ? m.lastName : guardian.firstName, dateOfBirth: m.dateOfBirth, gender: m.gender === 'FEMALE' ? 'FEMALE' : 'MALE',
        address: guardian.city ?? '-', city: guardian.city ?? '-', phoneNumber: guardian.phoneNumber, emergencyContact: guardian.phoneNumber,
        schoolName: m.school, priorProgrammingExperience: m.experience, campusId, batchId, rollNumber: reg.replace(/\//g, '-'),
        deliveryMode: online ? 'ONLINE' : 'PHYSICAL', academicYear: `${year}-${year + 1}`, sourceOfInfo: 'WEBSITE',
        idCardQRCode: `TN-QR-${reg.replace(/\//g, '-')}`, guardians: { connect: { id: guardian.id } },
      },
    })
    await tx.familyMember.update({ where: { id: m.id }, data: { studentId: s.id } })
    return s
  })
  // the friend's invite code typed at sign-up: linked to the first student (before the first invoice → the welcome discount applies)
  const ref = await prisma.guardian.findUnique({ where: { id: guardian.id }, select: { referredBy: true } })
  if (ref?.referredBy) {
    const { linkReferral } = await import('@/lib/referrals/engine')
    await linkReferral({ studentId: student.id, codeOrPhone: ref.referredBy, userId: guardian.userId }).catch((e) => console.warn('[BOOKING] referral', e))
  }
  return student.id
}

/** Places a booking. X07: into a group → one family at a time per group (the last seat goes to one family only). */
export async function place(bookingId: string, actorId: string, holdHours?: number) {
  const b = await prisma.courseBooking.findUnique({ where: { id: bookingId }, select: { classSectionId: true, mode: true } })
  if (b?.classSectionId && b.mode !== 'RECORDED') return withSeatLock(b.classSectionId, () => placeUnlocked(bookingId, actorId, holdHours))
  return placeUnlocked(bookingId, actorId, holdHours)
}

/** Places a booking: the student, the code, the group (or waiting list / recorded course), the first invoice, the hold. */
async function placeUnlocked(bookingId: string, actorId: string, holdHours?: number) {
  const b = await prisma.courseBooking.findUnique({ where: { id: bookingId } })
  if (!b || !['HOLD', 'REVIEW'].includes(b.status)) return
  const guardian = await prisma.guardian.findUnique({ where: { id: b.guardianId }, select: { id: true, userId: true, firstName: true, lastName: true, phoneNumber: true, city: true } })
  if (!guardian) return
  const person = (await familyOf(guardian.id)).find((p) => (b.studentId && p.studentId === b.studentId) || (b.memberId && p.memberId === b.memberId))
    ?? (b.memberId ? { key: `m:${b.memberId}`, memberId: b.memberId, studentId: null } as FamilyPerson : null)
  if (!person) throw new BookingError('NOT_FOUND', 'Child not found', 404)
  const studentId = await studentFor(person, guardian, b.campusId!, b.mode !== 'BRANCH')
  await prisma.courseBooking.update({ where: { id: b.id }, data: { studentId } })
  if (b.code) await applyCodeToStudent(b.code, studentId, b.classSectionId, actorId).catch((e) => console.warn('[BOOKING] code not applied', e))
  const hours = holdHours ?? resolveRule(await prisma.bookingRule.findMany(), { campusId: b.campusId, levelId: b.levelId, groupId: b.classSectionId }).holdHours

  let groupId = b.classSectionId
  if (b.mode === 'RECORDED') {
    const { enrol } = await import('@/lib/recorded/engine')
    // the family books its own child: the staff place checks of enrol() are passed as the company
    const r = await enrol({ id: actorId, role: 'SUPER_ADMIN' } as never, { studentId, campusId: b.campusId!, levelId: b.levelId!, plan: (b.plan as 'ONE_TIME' | 'SUBSCRIPTION') ?? 'ONE_TIME' })
    groupId = r.groupId
  } else if (!groupId) {
    const level = await prisma.level.findUnique({ where: { id: b.levelId! }, select: { subjectId: true } })
    const w = await prisma.waitingListEntry.create({ data: { studentId, subjectId: level!.subjectId, levelId: b.levelId, campusId: b.campusId!, notes: 'Booked from the family account: no group time fits · حجز من حساب العيلة: مفيش ميعاد مناسب', createdById: actorId } })
    await prisma.courseBooking.update({ where: { id: b.id }, data: { status: 'WAITING', waitingEntryId: w.id, decidedAt: b.status === 'REVIEW' ? new Date() : undefined } })
    return
  } else if ((await groupSeats(groupId)).full) {
    const w = await waitForGroup(studentId, groupId, actorId, 'Booked from the family account · حجز من حساب العيلة')
    await prisma.courseBooking.update({ where: { id: b.id }, data: { status: 'WAITING', waitingEntryId: w.id } })
    return
  } else {
    const year = await getActiveAcademicYear()
    if (!year) throw new BookingError('NO_YEAR', 'No active academic year · مفيش سنة دراسية', 409)
    const reg = (await prisma.student.findUnique({ where: { id: studentId }, select: { registrationNumber: true } }))!.registrationNumber
    const old = await prisma.studentEnrollment.findFirst({ where: { studentId, classSectionId: groupId }, select: { id: true } })
    if (old) await prisma.studentEnrollment.update({ where: { id: old.id }, data: { status: 'ACTIVE', withdrawalReason: null } })
    else await createYearEnrollmentForStudent({ studentId, academicYearId: year.id, classSectionId: groupId, rollNumber: reg.replace(/\//g, '-'), deliveryMode: b.mode === 'ONLINE' ? 'ONLINE' : 'PHYSICAL' })
    const { generateMissingCycleInvoices } = await import('@/lib/groups/generate-invoices')
    await generateMissingCycleInvoices(groupId, actorId, studentId).catch((e) => console.error('[BOOKING] first invoice', e))
    // six phases E: an "after payment" group keeps the seat but the child joins only when paid (the booking tells the family)
    await (await import('@/lib/groups/entry')).holdUntilPaid(studentId, groupId, { tellFamily: false }).catch((e) => console.error('[BOOKING] hold until paid', e))
    await (await import('@/lib/groups/start')).checkReady(groupId).catch(() => false)
    // final test 14/11 (L02): the family already ticked "I agree to the course rules" in the booking — record it as the
    // group-rules acceptance so the rules window does not pop up again right after booking.
    await rulesAcceptedAtBooking(b.guardianId, studentId, groupId).catch((e) => console.error('[BOOKING] rules acceptance', e))
  }
  const inv = await prisma.feeInvoice.findFirst({ where: { studentId, classSectionId: groupId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, totalAmount: true, paidAmount: true, status: true } })
  // no invoice yet (the group bills later): the seat stays held without a deadline; syncBookings attaches the invoice when it exists
  const paid = !!inv && invoicePaid({ totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status })
  const holdUntil = paid || !inv ? null : new Date(Date.now() + hours * 3_600_000)
  await prisma.courseBooking.update({
    where: { id: b.id },
    data: { classSectionId: groupId, invoiceId: inv?.id ?? null, status: paid ? 'CONFIRMED' : 'HOLD', confirmedAt: paid ? new Date() : null, holdUntil, ...(b.status === 'REVIEW' ? { decidedAt: new Date() } : {}) },
  })
  if (inv && holdUntil) await dueByHold(inv.id, holdUntil)
  await tellFamily(b.id)
}

async function rulesAcceptedAtBooking(guardianId: string | null, studentId: string, groupId: string) {
  if (!guardianId) return
  const g = await prisma.guardian.findUnique({ where: { id: guardianId }, select: { userId: true } })
  const r = await (await import('@/lib/rules/group-rules-engine')).rulesForGroup(groupId)
  if (!g?.userId || !r) return
  await prisma.groupRulesAcceptance.upsert({
    where: { classSectionId_studentId_userId_rulesHash: { classSectionId: groupId, studentId, userId: g.userId, rulesHash: r.hash } },
    create: { classSectionId: groupId, studentId, userId: g.userId, rulesHash: r.hash, userAgent: 'booking' },
    update: {},
  })
}

/** L02 (final test 14/11): the family saw "pay before Mon 10:37 pm" (seat hold) and "due 21 Nov" (invoice) — one date: the earlier. */
async function dueByHold(invoiceId: string, holdUntil: Date) {
  try {
    await prisma.feeInvoice.updateMany({ where: { id: invoiceId, dueDate: { gt: holdUntil }, status: { in: ['ISSUED', 'OVERDUE'] } }, data: { dueDate: holdUntil } })
  } catch (e) { console.error('[BOOKING] due by hold', e) } // never breaks the booking
}

// ── keeping bookings up to date ──────────────────────────────────────────────

let lastSync = 0
/** `guardianId`: only that family, at once (its own page). Without: everyone, at most every 30 s (or `force`, the daily job). */
export async function syncBookings(force: boolean | { guardianId: string } = false) {
  const one = typeof force === 'object' ? force.guardianId : null
  if (!one && !force && Date.now() - lastSync < 30_000) return { confirmed: 0, expired: 0 }
  if (!one) lastSync = Date.now()
  let confirmed = 0
  let expired = 0
  const holds = await prisma.courseBooking.findMany({ where: { status: { in: ['HOLD', 'WAITING'] }, ...(one ? { guardianId: one } : {}) }, take: 500 })
  for (const b of holds) {
    if (b.status === 'HOLD' && !b.invoiceId && b.studentId && b.classSectionId) {
      const found = await prisma.feeInvoice.findFirst({ where: { studentId: b.studentId, classSectionId: b.classSectionId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      if (found) {
        const hours = resolveRule(await prisma.bookingRule.findMany(), { campusId: b.campusId, levelId: b.levelId, groupId: b.classSectionId }).holdHours
        await prisma.courseBooking.update({ where: { id: b.id }, data: { invoiceId: found.id, holdUntil: new Date(Date.now() + hours * 3_600_000) } })
        await dueByHold(found.id, new Date(Date.now() + hours * 3_600_000))
        b.invoiceId = found.id
        b.holdUntil = new Date(Date.now() + hours * 3_600_000)
      }
    }
    if (b.status === 'WAITING') {
      const w = b.waitingEntryId ? await prisma.waitingListEntry.findUnique({ where: { id: b.waitingEntryId }, select: { status: true, placedClassSectionId: true } }) : null
      if (w?.status === 'PLACED') await prisma.courseBooking.update({ where: { id: b.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), classSectionId: w.placedClassSectionId ?? b.classSectionId } })
      if (w?.status === 'CANCELLED') await prisma.courseBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED', reason: 'removed from the waiting list' } })
      continue
    }
    const inv = b.invoiceId ? await prisma.feeInvoice.findUnique({ where: { id: b.invoiceId }, select: { totalAmount: true, paidAmount: true, status: true, proofStatus: true, classSection: { select: { installmentsAllowed: true } } } }) : null
    const state = inv ? { totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status, proofStatus: inv.proofStatus } : null
    if (invoicePaid(state, !!inv?.classSection?.installmentsAllowed)) {
      await prisma.courseBooking.update({ where: { id: b.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), holdUntil: null } })
      await tellFamily(b.id)
      confirmed++
    } else if (holdExpired(b.holdUntil, state, new Date())) {
      if (await attendedGroup(b.studentId, b.classSectionId)) {
        // owner 23/11: a child who already attends is never removed by the system — the office decides (Exclude / more time).
        // remindersSent 3 = "the office was told"; the booking stays in "your work today" (held seats past their time).
        if (b.remindersSent < 3) {
          await prisma.courseBooking.update({ where: { id: b.id }, data: { remindersSent: 3 } })
          await tellStaffUnpaidAttending(b.id)
        }
        continue
      }
      await release(b.id, 'EXPIRED', 'Not paid in time · مادفعش في الميعاد')
      expired++
    } else if (b.holdUntil && !(state && state.paidAmount > 0)) {
      // six phases E: remind the family a day and 3 hours before the seat is let go
      const left = (new Date(b.holdUntil).getTime() - Date.now()) / 3_600_000
      const due = left <= 3 ? 2 : left <= 24 ? 1 : 0
      if (due > b.remindersSent) {
        await prisma.courseBooking.update({ where: { id: b.id }, data: { remindersSent: due } })
        await remindFamily(b.id, left)
      }
    }
  }
  return { confirmed, expired }
}

/** Ends a held / waiting booking: enrolment withdrawn, unpaid invoice cancelled, seat freed, code given back (nothing paid). */
async function release(bookingId: string, status: BookingStatus, reason: string, deciderId?: string | null) {
  const b = await prisma.courseBooking.findUnique({ where: { id: bookingId } })
  if (!b) return
  // C05 (23/11): claim the change first — two runs at the same moment (daily job + family page) act once only
  const claimed = await prisma.courseBooking.updateMany({ where: { id: b.id, status: b.status }, data: { status, reason, holdUntil: null, decidedById: deciderId ?? undefined, decidedAt: new Date() } })
  if (!claimed.count) return
  const paidSomething = b.invoiceId ? Number((await prisma.feeInvoice.findUnique({ where: { id: b.invoiceId }, select: { paidAmount: true } }))?.paidAmount ?? 0) > 0 : false
  if (b.studentId && b.classSectionId && b.status === 'HOLD') {
    await prisma.studentEnrollment.updateMany({ where: { studentId: b.studentId, classSectionId: b.classSectionId, status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] } }, data: { status: 'WITHDRAWN', withdrawalReason: status === 'EXPIRED' ? 'BOOKING_EXPIRED' : 'BOOKING_CANCELLED' } })
    if (b.invoiceId) await prisma.feeInvoice.updateMany({ where: { id: b.invoiceId, paidAmount: 0 }, data: { status: 'CANCELLED', notes: `Booking ${status.toLowerCase()} · الحجز ${status === 'EXPIRED' ? 'انتهى' : 'اتلغى'}` } })
    await notifySeatFreed(b.classSectionId).catch(() => null)
  }
  if (b.waitingEntryId) await prisma.waitingListEntry.updateMany({ where: { id: b.waitingEntryId, status: 'WAITING' }, data: { status: 'CANCELLED' } })
  if (b.code && !paidSomething) await giveBackCode(b).catch((e) => console.warn('[BOOKING] code not given back', e))
  await tellFamily(b.id)
}

/**
 * C05 (owner 23/11): a booking that ends with nothing paid gives its enrolment code back — the use is removed (the family
 * can type it again) and the discount made from it for this child is ended. Called once per booking (release claims first).
 */
async function giveBackCode(b: { code: string | null; guardianId: string; studentId: string | null }) {
  if (!b.code) return
  const row = await prisma.enrolmentCode.findUnique({ where: { code: b.code }, select: { id: true, code: true, discountTypeId: true } })
  const g = await prisma.guardian.findUnique({ where: { id: b.guardianId }, select: { phoneNumber: true } })
  if (!row || !g) return
  const use = await prisma.enrolmentCodeUse.findFirst({ where: { codeId: row.id, phone: g.phoneNumber }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!use) return
  const gone = await prisma.enrolmentCodeUse.deleteMany({ where: { id: use.id } })
  if (gone.count) await prisma.enrolmentCode.updateMany({ where: { id: row.id, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } })
  if (b.studentId && row.discountTypeId) {
    await prisma.discountAssignment.updateMany({ where: { studentId: b.studentId, discountTypeId: row.discountTypeId, status: 'ACTIVE', reason: { contains: row.code } }, data: { status: 'ENDED' } })
  }
}

/**
 * C05/D08 (owner 23/11): a receipt cancelled by mistake makes the invoice due again — a booking confirmed by that invoice
 * goes back to "held until paid" with a new deadline (same rule as a new booking), the family is told, and the staff who
 * asked / approved hear that the seat is held again. An "after payment" group puts the child back to waiting for payment.
 */
export async function reopenAfterVoid(invoiceId: string, staffIds: string[], receipt: string | null) {
  const rows = await prisma.courseBooking.findMany({ where: { invoiceId, status: 'CONFIRMED' } })
  if (!rows.length) return 0
  const inv = await prisma.feeInvoice.findUnique({ where: { id: invoiceId }, select: { totalAmount: true, paidAmount: true, status: true, proofStatus: true, classSection: { select: { installmentsAllowed: true } } } })
  if (!inv) return 0
  // still paid enough (installments / another payment): the booking stays confirmed
  if (invoicePaid({ totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status, proofStatus: inv.proofStatus }, !!inv.classSection?.installmentsAllowed)) return 0
  const rules = await prisma.bookingRule.findMany()
  let n = 0
  for (const b of rows) {
    const holdUntil = new Date(Date.now() + resolveRule(rules, { campusId: b.campusId, levelId: b.levelId, groupId: b.classSectionId }).holdHours * 3_600_000)
    const why = `Receipt ${receipt ?? ''} was cancelled — the seat is held until the invoice is paid · الإيصال ${receipt ?? ''} اتلغى — المكان محجوز لحد ما الفاتورة تتدفع`
    const done = await prisma.courseBooking.updateMany({ where: { id: b.id, status: 'CONFIRMED' }, data: { status: 'HOLD', confirmedAt: null, holdUntil, remindersSent: 0, reason: why } })
    if (!done.count) continue
    n++
    await dueByHold(invoiceId, holdUntil)
    if (b.studentId && b.classSectionId) await (await import('@/lib/groups/entry')).holdUntilPaid(b.studentId, b.classSectionId, { tellFamily: false }).catch((e) => console.error('[BOOKING] hold after void', e))
    await tellFamily(b.id)
    try {
      const v = await bookingView(b.id)
      const en = holdUntil.toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      const ar = holdUntil.toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      await notifyUsers(staffIds, 'PAYMENT_VOID_REQUEST', {
        title: `Booking held again: ${v?.who ?? ''} — ${v?.course.en ?? ''}`, message: `Receipt ${receipt ?? ''} was cancelled, so the seat waits for payment again until ${en}.`,
        titleAr: `الحجز رجع محجوز: ${v?.who ?? ''} — ${v?.course.ar ?? ''}`, messageAr: `الإيصال ${receipt ?? ''} اتلغى، فالمكان مستني الدفع تاني لحد ${ar}.`, relatedId: b.id,
      })
    } catch (e) { console.warn('[BOOKING_NOTIFY]', e) }
  }
  return n
}

/** C05: the student already came to sessions of this group (present or late) — staff decide, the seat is never let go by itself. */
async function attendedGroup(studentId: string | null, groupId: string | null) {
  if (!studentId || !groupId) return false
  return (await prisma.enrollmentAttendanceRecord.count({ where: { status: { in: ['PRESENT', 'LATE'] }, studentEnrollment: { studentId, classSectionId: groupId } } })) > 0
}

export async function cancelByFamily(guardianId: string, bookingId: string) {
  const b = await prisma.courseBooking.findFirst({ where: { id: bookingId, guardianId } })
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found', 404)
  if (!['REVIEW', 'PLACEMENT', 'HOLD', 'WAITING'].includes(b.status)) throw new BookingError('CLOSED', 'This booking cannot be cancelled here. Ask TechNova · الحجز ده مايتلغيش من هنا. كلّم TechNova', 409)
  if (b.status === 'HOLD' && b.invoiceId && Number((await prisma.feeInvoice.findUnique({ where: { id: b.invoiceId }, select: { paidAmount: true } }))?.paidAmount ?? 0) > 0) {
    throw new BookingError('PAID', 'Something was already paid: ask TechNova (refund rules) · فيه فلوس اتدفعت: كلّم TechNova', 409)
  }
  await release(b.id, 'CANCELLED', 'Cancelled by the family · العيلة لغت الحجز')
}

/** Staff approve / reject a booking that waits for them (their places only). */
/** For a booking waiting for its level: the course's levels and the groups that fit the booking's way / place. */
export async function placementOptions(bookingId: string) {
  const b = await prisma.courseBooking.findUnique({ where: { id: bookingId } })
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found', 404)
  const c = (await publicCatalog({ slug: b.listingSlug }))[0]
  if (!c) throw new BookingError('NOT_FOUND', 'The course page is closed · صفحة الكورس مقفولة', 404)
  const levels = await courseLevels(c)
  const groups = b.mode === 'RECORDED' ? [] : await prisma.classSection.findMany({
    where: { levelId: { in: levels.map((l) => l.id) }, status: 'ACTIVE', isActive: true, kind: 'GROUP', ...(b.campusId ? { campusId: b.campusId } : {}) },
    select: { id: true, className: true, sectionName: true, levelId: true, scheduleSlots: true },
  })
  const recorded = b.mode === 'RECORDED' ? await prisma.recordedCourse.findMany({ where: { levelId: { in: levels.map((l) => l.id) }, isActive: true }, select: { levelId: true } }) : []
  return {
    levels: levels.filter((l) => b.mode !== 'RECORDED' || recorded.some((r) => r.levelId === l.id)).map((l) => ({ id: l.id, name: `${l.subject?.name ?? ''} — ${l.name}` })),
    groups: await Promise.all(groups.map(async (g) => ({ id: g.id, name: [g.className, g.sectionName].filter(Boolean).join(' '), levelId: g.levelId, slots: g.scheduleSlots, full: (await groupSeats(g.id)).full }))),
  }
}

export async function decide(staff: { id: string; role: string }, bookingId: string, action: 'APPROVE' | 'REJECT' | 'CANCEL' | 'PLACE', reason?: string | null, place2?: { levelId?: string | null; groupId?: string | null; plan?: string | null }) {
  const b = await prisma.courseBooking.findUnique({ where: { id: bookingId } })
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found', 404)
  if (b.campusId && !allowsCampus(await loadPlaces(staff), b.campusId)) throw new BookingError('NOT_YOURS', 'This booking is in another place · الحجز ده في مكان تاني', 403)
  if (action === 'PLACE') {
    if (b.status !== 'PLACEMENT') throw new BookingError('CLOSED', 'This booking is not waiting for a level · الحجز ده مش مستني مستوى', 409)
    const opts = await placementOptions(b.id)
    if (!place2?.levelId || !opts.levels.some((l) => l.id === place2.levelId)) throw new BookingError('NO_LEVEL', 'Choose the level · اختار المستوى')
    if (place2.groupId && !opts.groups.some((g) => g.id === place2.groupId && g.levelId === place2.levelId)) throw new BookingError('NO_GROUP', 'Choose a group of this level · اختار جروب من المستوى ده')
    await prisma.courseBooking.update({ where: { id: b.id }, data: { levelId: place2.levelId, classSectionId: place2.groupId || null, plan: b.mode === 'RECORDED' ? place2.plan || b.plan || 'ONE_TIME' : b.plan, status: 'REVIEW', decidedById: staff.id } })
    await place(b.id, staff.id)
  } else if (action === 'APPROVE') {
    if (b.status !== 'REVIEW') throw new BookingError('CLOSED', 'Already decided · اتقرر قبل كده', 409)
    await prisma.courseBooking.update({ where: { id: b.id }, data: { decidedById: staff.id } })
    await place(b.id, staff.id)
  } else if (action === 'REJECT') {
    if (!['REVIEW', 'PLACEMENT'].includes(b.status)) throw new BookingError('CLOSED', 'Already decided · اتقرر قبل كده', 409)
    await release(b.id, 'REJECTED', reason || 'Not accepted · ماتقبلش', staff.id)
  } else {
    if (!['HOLD', 'WAITING', 'REVIEW', 'PLACEMENT'].includes(b.status)) throw new BookingError('CLOSED', 'Already closed · اتقفل قبل كده', 409)
    await release(b.id, 'CANCELLED', reason || 'Cancelled by TechNova · TechNova لغت الحجز', staff.id)
  }
  return bookingView(b.id)
}

// ── views + messages ─────────────────────────────────────────────────────────

export async function bookingView(id: string) {
  const b = await prisma.courseBooking.findUnique({ where: { id } })
  if (!b) return null
  return (await shape([b]))[0]
}

export async function shape(rows: Awaited<ReturnType<typeof prisma.courseBooking.findMany>>) {
  const [listings, groups, invoices, students, members, guardians, levels] = await Promise.all([
    prisma.courseListing.findMany({ where: { slug: { in: rows.map((r) => r.listingSlug) } }, select: { slug: true, titleEn: true, titleAr: true } }),
    prisma.classSection.findMany({ where: { id: { in: rows.map((r) => r.classSectionId).filter(Boolean) as string[] } }, select: { id: true, className: true, sectionName: true, scheduleSlots: true, campus: { select: { name: true } } } }),
    prisma.feeInvoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, challanNumber: true, totalAmount: true, paidAmount: true, status: true, proofStatus: true } }),
    prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }),
    prisma.familyMember.findMany({ where: { id: { in: rows.map((r) => r.memberId).filter(Boolean) as string[] } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.guardian.findMany({ where: { id: { in: rows.map((r) => r.guardianId) } }, select: { id: true, firstName: true, lastName: true, phoneNumber: true } }),
    prisma.level.findMany({ where: { id: { in: rows.map((r) => r.levelId).filter(Boolean) as string[] } }, select: { id: true, name: true, subject: { select: { name: true } } } }),
  ])
  // six phases E2: the group's start (waiting for its minimum / complete) for the family's view
  const { groupStart } = await import('@/lib/groups/start')
  const starts = new Map<string, { state: string; expectedStartDate: string | null; firstSession: string | null }>()
  for (const id of [...new Set(rows.map((r) => r.classSectionId).filter(Boolean) as string[])]) {
    const s = await groupStart(id).catch(() => null)
    if (s) starts.set(id, { state: s.state, expectedStartDate: s.expectedStartDate, firstSession: s.firstSession })
  }
  return rows.map((b) => {
    const l = listings.find((x) => x.slug === b.listingSlug)
    const g = groups.find((x) => x.id === b.classSectionId)
    const inv = invoices.find((x) => x.id === b.invoiceId)
    const who = students.find((x) => x.id === b.studentId) ?? members.find((x) => x.id === b.memberId)
    const lv = levels.find((x) => x.id === b.levelId)
    return {
      id: b.id, status: b.status as BookingStatus, statusText: STATUS_TEXT[b.status as BookingStatus], mode: b.mode, plan: b.plan, code: b.code,
      // C05: never the link name (nova-explorer) — the course title, else the course of the level
      course: { slug: b.listingSlug, en: l?.titleEn || lv?.subject?.name || b.listingSlug, ar: l?.titleAr || l?.titleEn || lv?.subject?.name || b.listingSlug }, level: lv ? `${lv.subject?.name ?? ''} — ${lv.name}` : null,
      who: who ? `${who.firstName} ${who.lastName}` : '—', registrationNumber: (who as { registrationNumber?: string } | undefined)?.registrationNumber ?? null,
      family: guardians.find((x) => x.id === b.guardianId) ?? null,
      group: g ? { id: g.id, name: [g.className, g.sectionName].filter(Boolean).join(' '), campus: g.campus.name, slots: g.scheduleSlots } : null,
      invoice: inv ? { id: inv.id, number: inv.challanNumber, total: Number(inv.totalAmount), paid: Number(inv.paidAmount), status: inv.status, proofStatus: inv.proofStatus } : null,
      holdUntil: b.holdUntil, reason: b.reason, createdAt: b.createdAt, confirmedAt: b.confirmedAt, campusId: b.campusId,
      start: b.classSectionId ? starts.get(b.classSectionId) ?? null : null,
    }
  })
}

async function tellStaff(bookingId: string, guardian: Guardian, person: FamilyPerson, title: { en: string; ar: string }, mode: string, review: boolean) {
  try {
    const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'SECRETARY'] } }, select: { id: true } })
    const way = mode === 'ONLINE' ? ['live online', 'لايف أونلاين'] : mode === 'RECORDED' ? ['recorded', 'مسجل'] : ['at a branch', 'في الفرع']
    await notifyUsers(staff.map((u) => u.id), 'BOOKING_NEW', {
      title: `${review ? 'Booking to approve' : 'New booking'}: ${title.en} (${way[0]})`, message: `${person.firstName} · ${guardian.firstName} ${guardian.lastName} · ${guardian.phoneNumber}`,
      titleAr: `${review ? 'حجز مستني موافقتك' : 'حجز جديد'}: ${title.ar} (${way[1]})`, messageAr: `${person.firstName} · ${guardian.firstName} ${guardian.lastName} · ${guardian.phoneNumber}`, relatedId: bookingId,
    })
  } catch (e) { console.warn('[BOOKING_NOTIFY]', e) }
}

async function tellStaffUnpaidAttending(bookingId: string) {
  try {
    const v = await bookingView(bookingId)
    const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'BRANCH_MANAGER'] } }, select: { id: true } })
    await notifyUsers(staff.map((u) => u.id), 'BOOKING_NEW', {
      title: `Unpaid but attending: ${v?.who ?? ''} — ${v?.course.en ?? ''}`, message: 'The seat time ended unpaid, but the student already attends. Decide: Exclude, or give more time.',
      titleAr: `مادفعش وبيحضر: ${v?.who ?? ''} — ${v?.course.ar ?? ''}`, messageAr: 'مهلة المكان خلصت من غير دفع، بس الطالب بيحضر فعلًا. قرّر: استبعاد أو مهلة تانية.', relatedId: bookingId,
    })
  } catch (e) { console.warn('[BOOKING_NOTIFY]', e) }
}

/** "Pay before …": the seat is let go when the hold ends. */
async function remindFamily(bookingId: string, hoursLeft: number) {
  try {
    const v = await bookingView(bookingId)
    const b = await prisma.courseBooking.findUnique({ where: { id: bookingId }, select: { guardianId: true, holdUntil: true } })
    const g = b ? await prisma.guardian.findUnique({ where: { id: b.guardianId }, select: { userId: true } }) : null
    if (!v || !g || !b?.holdUntil) return
    const amount = v.invoice ? v.invoice.total - v.invoice.paid : null
    const when = new Date(b.holdUntil)
    const en = when.toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const ar = when.toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    await notifyUsers([g.userId], 'BOOKING_UPDATE', {
      title: `${hoursLeft <= 3 ? 'Last hours' : 'Reminder'}: pay for ${v.who}'s seat in ${v.course.en} before ${en}`,
      message: `${amount != null ? `${amount} EGP. ` : ''}After that time the seat is given to someone else. Pay from My children → Fees.`,
      titleAr: `${hoursLeft <= 3 ? 'آخر ساعات' : 'تذكير'}: ادفع لمكان ${v.who} في ${v.course.ar} قبل ${ar}`,
      messageAr: `${amount != null ? `${amount} ج.م. ` : ''}بعد الميعاد ده المكان بيروح لحد تاني. ادفع من أولادي ← الفواتير.`, relatedId: bookingId,
    })
  } catch (e) { console.warn('[BOOKING_REMIND]', e) }
}

/** C05: reasons are stored "English · عربي" — each message gets its own language only. */
export function half(text: string | null | undefined, lang: 'en' | 'ar'): string | null {
  if (!text) return null
  const i = text.indexOf(' · ')
  if (i < 0) return text
  return (lang === 'en' ? text.slice(0, i) : text.slice(i + 3)).trim() || text
}

async function tellFamily(bookingId: string) {
  try {
    const v = await bookingView(bookingId)
    const b = await prisma.courseBooking.findUnique({ where: { id: bookingId }, select: { guardianId: true } })
    const g = b ? await prisma.guardian.findUnique({ where: { id: b.guardianId }, select: { userId: true } }) : null
    if (!v || !g) return
    await notifyUsers([g.userId], 'BOOKING_UPDATE', {
      title: `${v.course.en} — ${v.who}: ${v.statusText.en}`, message: v.status === 'HOLD' ? 'Pay the first invoice to confirm the seat.' : half(v.reason, 'en') ?? v.statusText.en,
      titleAr: `${v.course.ar} — ${v.who}: ${v.statusText.ar}`, messageAr: v.status === 'HOLD' ? 'ادفع أول فاتورة علشان المكان يتأكد.' : half(v.reason, 'ar') ?? v.statusText.ar, relatedId: bookingId,
    })
  } catch (e) { console.warn('[BOOKING_NOTIFY]', e) }
}
