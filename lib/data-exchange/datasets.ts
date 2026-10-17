/**
 * Phase 6: the server side of each dataset — the dropdown lists (only the person's places), the export rows (only
 * the person's places) and how one import row is saved. Imports call THE SAME API handlers the screens use
 * (students, groups, instructors, tracks / courses / levels), so every business rule applies to imported rows too:
 * TN/YYYY/NNNN numbers, parent by phone, full group → waiting list, invoices, places, shift from the schedule, …
 * Server-only.
 */

import { randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadPlaces } from '@/lib/places/server'
import { campusWhere, groupWhere, invoiceWhere, studentWhere, teacherWhere, type Places } from '@/lib/places/rules'
import { staffNames } from '@/lib/contacts/contact-log'
import { parseSchedule, type RefLists } from './parse'
import type { DatasetKey } from './registry'

type Who = { id: string; role: string }
export interface ExportFilters { campusId?: string | null; from?: string | null; to?: string | null; groupId?: string | null; status?: string | null }
export type ImportOutcome = { ok: true; id?: string; note?: string } | { ok: false; reason: string }

const day = (d: string) => new Date(`${d}T00:00:00.000Z`)
const dateRange = (f: ExportFilters) => (f.from || f.to ? { ...(f.from && { gte: day(f.from) }), ...(f.to && { lt: new Date(day(f.to).getTime() + 86_400_000) }) } : undefined)
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100
const fullName = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}`.trim() : '')
const groupLabel = (g: { className: string; sectionName: string } | null | undefined) => (g ? `${g.className} ${g.sectionName}`.trim() : '')
const AND = (...parts: Record<string, unknown>[]) => ({ AND: parts.filter((p) => Object.keys(p).length) })

/** The dropdown lists for the template and the names an upload may use — only inside the person's places. */
export async function refLists(user: Who): Promise<{ refs: RefLists; places: Places }> {
  const places = await loadPlaces(user)
  const [campuses, groups, levels] = await Promise.all([
    prisma.campus.findMany({ where: { isActive: true, ...campusWhere(places, 'id') }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.classSection.findMany({ where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, ...groupWhere(places) }, select: { id: true, className: true, sectionName: true, campus: { select: { name: true } } }, orderBy: { className: 'asc' } }),
    prisma.level.findMany({ where: { isActive: true }, select: { id: true, name: true, subject: { select: { name: true, code: true } } }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] }),
  ])
  return {
    places,
    refs: {
      campus: campuses.map((c) => ({ id: c.id, name: c.name, aliases: c.code ? [c.code] : [] })),
      group: groups.map((g) => ({ id: g.id, name: `${groupLabel(g)} · ${g.campus?.name ?? ''}`, aliases: [groupLabel(g)] })),
      level: levels.map((l) => ({ id: l.id, name: `${l.subject?.name ?? ''} — ${l.name}`, aliases: [`${l.subject?.code ?? ''} — ${l.name}`] })),
    },
  }
}

// ── export ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LIMIT = 10000

export async function exportRows(key: DatasetKey, user: Who, f: ExportFilters): Promise<Record<string, unknown>[]> {
  const places = await loadPlaces(user)
  const onlyCampus = f.campusId ? { campusId: f.campusId } : {}
  switch (key) {
    case 'students': {
      const rows = await prisma.student.findMany({
        where: AND(studentWhere(places), onlyCampus, f.status ? { enrollmentStatus: f.status as never } : {}, f.groupId ? { enrollments: { some: { classSectionId: f.groupId, status: 'ACTIVE' } } } : {}) as Prisma.StudentWhereInput,
        include: { campus: { select: { name: true } }, guardians: { select: { firstName: true, lastName: true, phoneNumber: true }, take: 1 }, enrollments: { where: { status: 'ACTIVE' }, select: { classSection: { select: { className: true, sectionName: true } } } } },
        orderBy: { createdAt: 'asc' }, take: LIMIT,
      })
      return rows.map((s) => ({
        registrationNumber: s.registrationNumber, firstName: s.firstName, lastName: s.lastName, fullNameAr: s.fullNameAr, fatherName: s.fatherName,
        gender: s.gender, dateOfBirth: ymd(s.dateOfBirth), phoneNumber: s.phoneNumber, emergencyContact: s.emergencyContact, address: s.address, city: s.city,
        campus: s.campus?.name ?? '', group: s.enrollments.map((e) => groupLabel(e.classSection)).join('، '),
        guardianFirstName: s.guardians[0]?.firstName ?? '', guardianLastName: s.guardians[0]?.lastName ?? '', guardianPhone: s.guardians[0]?.phoneNumber ?? '',
        email: s.email ?? '', schoolName: s.schoolName ?? '', regularSchoolGrade: s.regularSchoolGrade ?? '', medicalNotes: s.medicalNotes ?? '',
        status: s.enrollmentStatus, joinedAt: ymd(s.createdAt),
      }))
    }
    case 'guardians': {
      const rows = await prisma.guardian.findMany({
        where: { students: { some: AND(studentWhere(places), onlyCampus) as Prisma.StudentWhereInput } },
        include: { students: { select: { firstName: true, lastName: true, campus: { select: { name: true } } } }, user: { select: { email: true } } },
        orderBy: { firstName: 'asc' }, take: LIMIT,
      })
      return rows.map((g) => ({
        name: fullName(g), phone: g.phoneNumber, email: g.user?.email && !g.user.email.endsWith('.local') ? g.user.email : '',
        children: g.students.map(fullName).join('، '), campus: [...new Set(g.students.map((s) => s.campus?.name ?? ''))].join('، '), active: g.isActive,
      }))
    }
    case 'groups': {
      const rows = await prisma.classSection.findMany({
        where: AND(groupWhere(places), onlyCampus, { levelId: { not: null }, isActive: true }, f.status ? { status: f.status as never } : {}) as Prisma.ClassSectionWhereInput,
        include: {
          campus: { select: { name: true } }, level: { select: { name: true, subject: { select: { name: true } } } },
          subjectOfferings: { where: { teacherId: { not: null } }, select: { teacher: { select: { firstName: true, lastName: true } } }, take: 1, orderBy: { createdAt: 'desc' } },
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: { className: 'asc' }, take: LIMIT,
      })
      const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت']
      return rows.map((g) => ({
        name: g.className, section: g.sectionName, campus: g.campus?.name ?? '', level: `${g.level?.subject?.name ?? ''} — ${g.level?.name ?? ''}`,
        schedule: ((g.scheduleSlots as { dayOfWeek: number; time: string }[] | null) ?? []).map((s) => `${DAYS[s.dayOfWeek] ?? ''} ${s.time}`).join('، '),
        maxStudents: g.maxStudents ?? '', instructor: fullName(g.subjectOfferings[0]?.teacher), students: g._count.enrollments, status: g.status, startDate: ymd(g.startDate),
      }))
    }
    case 'instructors': {
      const rows = await prisma.teacher.findMany({
        where: AND(teacherWhere(places), onlyCampus) as Prisma.TeacherWhereInput,
        include: { campus: { select: { name: true } }, user: { select: { email: true } }, subjectOfferings: { where: { classSection: { status: 'ACTIVE' } }, select: { classSection: { select: { className: true, sectionName: true } } } } },
        orderBy: { firstName: 'asc' }, take: LIMIT,
      })
      return rows.map((t) => ({
        firstName: t.firstName, lastName: t.lastName, nationalId: t.cnic, gender: t.gender, dateOfBirth: ymd(t.dateOfBirth), phoneNumber: t.phoneNumber,
        email: t.user?.email ?? t.email ?? '', address: t.address, city: t.city, emergencyContact: t.emergencyContact, designation: t.designation,
        joiningDate: ymd(t.joiningDate), campus: t.campus?.name ?? '', qualification: t.qualification ?? '', specialization: t.specialization ?? '',
        groups: [...new Set(t.subjectOfferings.map((o) => groupLabel(o.classSection)))].join('، '), active: t.isActive,
      }))
    }
    case 'courseStructure': {
      const rows = await prisma.level.findMany({ where: { isActive: true }, include: { subject: { select: { name: true, code: true, track: { select: { name: true } } } } }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] })
      return rows.map((l) => ({
        track: l.subject?.track?.name ?? '', course: l.subject?.name ?? '', courseCode: l.subject?.code ?? '', level: l.name, order: l.order,
        sessions: l.numberOfSessions, months: l.numberOfMonths, pricing: l.pricingType,
        price: money(l.pricingType === 'FULL_LEVEL' ? l.fullLevelPrice : l.monthlyPrice),
      }))
    }
    case 'invoices': {
      const rows = await prisma.feeInvoice.findMany({
        where: AND(invoiceWhere(places), f.campusId ? { student: { campusId: f.campusId } } : {}, dateRange(f) ? { createdAt: dateRange(f) } : {}, f.status ? { status: f.status as never } : {}) as Prisma.FeeInvoiceWhereInput,
        include: { student: { select: { firstName: true, lastName: true, registrationNumber: true } }, classSection: { select: { className: true, sectionName: true } } },
        orderBy: { createdAt: 'desc' }, take: LIMIT,
      })
      return rows.map((i) => ({
        number: i.challanNumber, student: fullName(i.student), registrationNumber: i.student?.registrationNumber ?? '', group: groupLabel(i.classSection), month: i.month,
        total: money(i.totalAmount), discount: money(i.discount), paid: money(i.paidAmount), refunded: money(i.refundedAmount),
        remaining: money(Number(i.totalAmount) - Number(i.paidAmount)), status: i.status, dueDate: ymd(i.dueDate), createdAt: ymd(i.createdAt),
      }))
    }
    case 'payments': {
      const rows = await prisma.feePayment.findMany({
        where: AND({ invoice: AND(invoiceWhere(places), f.campusId ? { student: { campusId: f.campusId } } : {}) }, dateRange(f) ? { paymentDate: dateRange(f) } : {}) as Prisma.FeePaymentWhereInput,
        include: { invoice: { select: { challanNumber: true, student: { select: { firstName: true, lastName: true, registrationNumber: true } } } } },
        orderBy: { paymentDate: 'desc' }, take: LIMIT,
      })
      const names = await staffNames(rows.map((p) => p.receivedBy).filter((x): x is string => !!x))
      return rows.map((p) => ({
        receipt: p.receiptNumber ?? '', date: ymd(p.paymentDate), student: fullName(p.invoice?.student), registrationNumber: p.invoice?.student?.registrationNumber ?? '',
        invoice: p.invoice?.challanNumber ?? '', amount: money(p.amount), method: p.paymentMethod, source: p.source ?? '', receivedBy: (p.receivedBy && names.get(p.receivedBy)) ?? '',
      }))
    }
    case 'attendance': {
      const range = dateRange(f) ?? { gte: new Date(Date.now() - 31 * 86_400_000) }
      const rows = await prisma.enrollmentAttendanceRecord.findMany({
        where: { attendanceDate: range, studentEnrollment: { ...(f.groupId ? { classSectionId: f.groupId } : {}), classSection: AND(groupWhere(places), onlyCampus) as Prisma.ClassSectionWhereInput } },
        include: { studentEnrollment: { select: { student: { select: { firstName: true, lastName: true, registrationNumber: true } }, classSection: { select: { className: true, sectionName: true } } } } },
        orderBy: [{ attendanceDate: 'desc' }], take: LIMIT,
      })
      return rows.map((r) => ({
        date: ymd(r.attendanceDate), group: groupLabel(r.studentEnrollment.classSection), student: fullName(r.studentEnrollment.student),
        registrationNumber: r.studentEnrollment.student?.registrationNumber ?? '', status: r.status, note: r.remarks ?? '',
      }))
    }
    case 'waitingList': {
      const rows = await prisma.waitingListEntry.findMany({
        where: AND({ status: 'WAITING' }, campusWhere(places), onlyCampus) as Prisma.WaitingListEntryWhereInput,
        include: { student: { select: { firstName: true, lastName: true, guardians: { select: { phoneNumber: true }, take: 1 } } }, level: { select: { name: true } }, subject: { select: { name: true } }, campus: { select: { name: true } } },
        orderBy: { createdAt: 'asc' }, take: LIMIT,
      })
      const groups = new Map((await prisma.classSection.findMany({ where: { id: { in: rows.map((r) => r.classSectionId).filter((x): x is string => !!x) } }, select: { id: true, className: true, sectionName: true } })).map((g) => [g.id, groupLabel(g)]))
      return rows.map((w) => ({
        student: fullName(w.student), phone: w.student?.guardians[0]?.phoneNumber ?? '', level: `${w.subject?.name ?? ''} — ${w.level?.name ?? ''}`,
        group: (w.classSectionId && groups.get(w.classSectionId)) ?? '', campus: w.campus?.name ?? '', since: ymd(w.createdAt),
      }))
    }
    case 'movements': {
      const accounts = await prisma.moneyAccount.findMany({ where: places.all ? (f.campusId ? { campusId: f.campusId } : {}) : { campusId: { in: f.campusId ? [f.campusId].filter((c) => places.campusIds.includes(c)) : places.campusIds } }, select: { id: true, name: true } })
      const names = new Map(accounts.map((a) => [a.id, a.name]))
      const rows = await prisma.moneyMovement.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, ...(dateRange(f) ? { date: dateRange(f) } : {}) }, orderBy: { date: 'desc' }, take: LIMIT })
      return rows.map((m) => ({ date: ymd(m.date), account: (m.accountId && names.get(m.accountId)) ?? '', direction: m.direction, amount: money(m.amount), kind: m.kind, method: m.method ?? '', note: m.note ?? '' }))
    }
    case 'expenses': {
      const rows = await prisma.expense.findMany({
        where: AND({ isDeleted: false }, campusWhere(places), onlyCampus, dateRange(f) ? { date: dateRange(f) } : {}) as Prisma.ExpenseWhereInput,
        include: { campus: { select: { name: true } } }, orderBy: { date: 'desc' }, take: LIMIT,
      })
      return rows.map((e) => ({ date: ymd(e.date), category: e.category, description: [e.title, e.description].filter(Boolean).join(' — '), amount: money(e.amount), campus: e.campus?.name ?? '', method: e.paymentSource ?? '' }))
    }
  }
}

// ── import ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Call one of our own API handlers with the signed-in person's session (same cookies) and read its JSON. */
async function callRoute(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  origin: string, cookie: string, path: string, method: string, body: unknown, params: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; message: string; code: string | null }> {
  const req = new NextRequest(new URL(path, origin), { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
  const res = await handler(req, { params: Promise.resolve(params) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown }; message?: string } | null
  // validation errors come as [{ field, message }] (lib/api-response.ts)
  const detail = json?.error?.details as { field?: string; message?: string }[] | undefined
  const fieldMsg = Array.isArray(detail) && detail.length ? detail.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message ?? ''}`).join('; ') : ''
  return { ok: res.ok && json?.success !== false, status: res.status, data: json?.data ?? null, message: fieldMsg || json?.error?.message || json?.message || `HTTP ${res.status}`, code: json?.error?.code ?? null }
}

export interface ImportCtx { user: Who; origin: string; cookie: string }

const iso = (d: unknown) => `${String(d)}T00:00:00.000Z`
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v))

export async function importRow(key: DatasetKey, ctx: ImportCtx, v: Record<string, unknown>): Promise<ImportOutcome> {
  const call = (h: Parameters<typeof callRoute>[0], path: string, method: string, body: unknown, params?: Record<string, string>) => callRoute(h, ctx.origin, ctx.cookie, path, method, body, params)
  switch (key) {
    case 'students': {
      if (v.group) {
        const g = await prisma.classSection.findUnique({ where: { id: String(v.group) }, select: { campusId: true } })
        if (g && g.campusId !== v.campus) return { ok: false, reason: 'The group is in another branch / الجروب في فرع تاني' }
      }
      const y = new Date().getFullYear()
      const { POST } = await import('@/app/api/students/route')
      const r = await call(POST as never, '/api/students', 'POST', {
        firstName: v.firstName, lastName: v.lastName, fullNameAr: v.fullNameAr, fatherName: v.fatherName, gender: v.gender, dateOfBirth: iso(v.dateOfBirth),
        phoneNumber: v.phoneNumber, emergencyContact: v.emergencyContact, address: v.address, city: v.city, email: str(v.email) ?? '',
        campusId: v.campus, academicYear: `${y}-${y + 1}`,
        guardianFirstName: str(v.guardianFirstName), guardianLastName: str(v.guardianLastName), guardianPhone: str(v.guardianPhone), guardianRelationship: str(v.guardianRelationship),
        schoolName: str(v.schoolName), regularSchoolGrade: str(v.regularSchoolGrade), medicalNotes: str(v.medicalNotes),
      })
      if (!r.ok) return { ok: false, reason: r.message }
      const id = String(r.data?.id ?? '')
      const notes: string[] = [String(r.data?.registrationNumber ?? ''), String(r.data?.guardianNote ?? '')].filter(Boolean)
      if (v.group && id) {
        // the same path as "Add to group" on the group page: enrolment + this month's invoice; a full group → waiting list
        const gid = String(v.group)
        const { POST: ADD } = await import('@/app/api/groups/[id]/students/route')
        let j = await call(ADD as never, `/api/groups/${gid}/students`, 'POST', { studentId: id }, { id: gid })
        if (!j.ok && j.code === 'GROUP_FULL') {
          j = await call(ADD as never, `/api/groups/${gid}/students`, 'POST', { studentId: id, waitlist: true }, { id: gid })
          if (j.ok) notes.push('Group full — on its waiting list / الجروب مليان — اتحط في قايمة الانتظار')
        }
        if (!j.ok) notes.push(`Saved, but not added to the group: ${j.message} / اتسجل بس ماتضافش للجروب`)
      }
      return { ok: true, id, note: notes.join(' — ') }
    }
    case 'groups': {
      let slots: { dayOfWeek: number; time: string }[] = []
      if (v.schedule) {
        const s = parseSchedule(String(v.schedule))
        if (s.error) return { ok: false, reason: 'Schedule not understood (e.g. "Sun 16:00, Wed 16:00") / المواعيد مش مفهومة' }
        slots = s.slots
      }
      const { POST } = await import('@/app/api/groups/route')
      const r = await call(POST as never, '/api/groups', 'POST', { campusId: v.campus, className: v.name, sectionName: str(v.section) || 'A', levelId: v.level, maxStudents: v.maxStudents ?? null })
      if (!r.ok) return { ok: false, reason: r.message }
      const id = String(r.data?.id ?? '')
      if (slots.length && id) {
        const { PATCH } = await import('@/app/api/groups/[id]/route')
        const p = await call(PATCH as never, `/api/groups/${id}`, 'PATCH', { scheduleSlots: slots }, { id })
        if (!p.ok) return { ok: true, id, note: `Group made, schedule not saved: ${p.message}` }
      }
      return { ok: true, id }
    }
    case 'instructors': {
      const { POST } = await import('@/app/api/teachers/route')
      const r = await call(POST as never, '/api/teachers', 'POST', {
        firstName: v.firstName, lastName: v.lastName, cnic: v.nationalId, gender: v.gender, dateOfBirth: iso(v.dateOfBirth), joiningDate: iso(v.joiningDate),
        designation: v.designation, phoneNumber: v.phoneNumber, email: v.email, address: v.address, city: v.city, emergencyContact: v.emergencyContact,
        campusId: v.campus, qualification: str(v.qualification) ?? '', specialization: str(v.specialization), experienceYears: 0,
        password: `Tn-${randomBytes(9).toString('base64url')}`, // never shown; staff give the real one with "Reset password"
      })
      return r.ok ? { ok: true, id: String(r.data?.id ?? '') } : { ok: false, reason: r.message }
    }
    case 'courseStructure': {
      const name = (s: unknown) => String(s).trim()
      let track = await prisma.track.findFirst({ where: { name: name(v.track) }, select: { id: true } })
      if (!track) {
        const { POST } = await import('@/app/api/tracks/route')
        const r = await call(POST as never, '/api/tracks', 'POST', { name: name(v.track) })
        if (!r.ok) return { ok: false, reason: `Track: ${r.message}` }
        track = { id: String(r.data?.id) }
      }
      let course = await prisma.academicSubject.findFirst({ where: { name: name(v.course), trackId: track.id }, select: { id: true } })
      if (!course) {
        const code = (str(v.courseCode) || name(v.course)).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || `C-${Date.now() % 100000}`
        const { POST } = await import('@/app/api/academic-subjects/route')
        const r = await call(POST as never, '/api/academic-subjects', 'POST', { name: name(v.course), code: code.length >= 2 ? code : `${code}-1`, trackId: track.id })
        if (!r.ok) return { ok: false, reason: `Course: ${r.message}` }
        course = { id: String(r.data?.id) }
      }
      const existing = await prisma.level.findFirst({ where: { subjectId: course.id, name: name(v.level) }, select: { id: true } })
      if (existing) return { ok: true, id: existing.id, note: 'Already there — kept / موجود — اتساب زي ما هو' }
      const { POST } = await import('@/app/api/levels/route')
      const monthly = v.pricing === 'MONTHLY'
      const r = await call(POST as never, '/api/levels', 'POST', {
        subjectId: course.id, name: name(v.level), order: Number(v.order), numberOfSessions: Number(v.sessions), numberOfMonths: Number(v.months),
        pricingType: v.pricing, monthlyPrice: monthly ? Number(v.price) : null, fullLevelPrice: monthly ? null : Number(v.price),
      })
      return r.ok ? { ok: true, id: String(r.data?.id ?? '') } : { ok: false, reason: `Level: ${r.message}` }
    }
    default:
      return { ok: false, reason: 'This table cannot be imported' }
  }
}
