/**
 * M0: an instructor's places, pay per place and employment periods.
 * GET (teachers:read) / PUT { allLocations, campusIds (extra places), pay: [{ campusId, fixed, percent, perSession }],
 * employment: [{ employer, partnerName?, kind, fromDate, toDate?, note? }] } (teachers:update).
 */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { forgetPlaces } from '@/lib/places/server'
import { periodsProblem } from '@/lib/teachers/employment'

const money = z.number().min(0).max(1_000_000).nullable()
const body = z.object({
  allLocations: z.boolean(),
  campusIds: z.array(z.string()).max(100),
  pay: z.array(z.object({ campusId: z.string().min(1), fixed: money, percent: z.number().min(0).max(100).nullable(), perSession: money })).max(100),
  employment: z.array(z.object({ employer: z.enum(['TECHNOVA', 'PARTNER']), partnerName: z.string().max(120).nullish(), kind: z.enum(['TEACHER', 'TRAINEE']), fromDate: z.string().min(8), toDate: z.string().nullish(), note: z.string().max(300).nullish() })).max(50),
})

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'teachers', 'read')) return errors.forbidden()
  const { id } = await params
  const t = await prisma.teacher.findUnique({ where: { id }, select: { campusId: true, userId: true, user: { select: { allLocations: true } } } })
  if (!t) return errors.notFound('Instructor')
  const [extra, pay, employment] = await Promise.all([
    prisma.userPlaceAccess.findMany({ where: { userId: t.userId }, select: { campusId: true } }),
    prisma.teacherPlacePay.findMany({ where: { teacherId: id } }),
    prisma.teacherEmployment.findMany({ where: { teacherId: id }, orderBy: { fromDate: 'asc' } }),
  ])
  const n = (v: unknown) => (v != null ? Number(v) : null)
  return successResponse({
    primary: t.campusId, allLocations: !!t.user?.allLocations, campusIds: extra.map((e) => e.campusId),
    pay: pay.map((p) => ({ campusId: p.campusId, fixed: n(p.fixedAmount), percent: n(p.percentOfStudentPayment), perSession: n(p.perSessionAmount) })),
    employment: employment.map((e) => ({ employer: e.employer, partnerName: e.partnerName, kind: e.kind, fromDate: e.fromDate.toISOString().slice(0, 10), toDate: e.toDate?.toISOString().slice(0, 10) ?? null, note: e.note })),
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'teachers', 'update')) return errors.forbidden()
  const { id } = await params
  const t = await prisma.teacher.findUnique({ where: { id }, select: { userId: true } })
  if (!t) return errors.notFound('Instructor')
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as z.infer<typeof body> & { campusIds: string[]; pay: { campusId: string; fixed: number | null; percent: number | null; perSession: number | null }[]; employment: { employer: string; partnerName?: string | null; kind: string; fromDate: string; toDate?: string | null; note?: string | null }[] }
  const periods = d.employment.map((e) => ({ employer: e.employer, kind: e.kind, fromDate: new Date(e.fromDate), toDate: e.toDate ? new Date(e.toDate) : null }))
  const problem = periodsProblem(periods)
  if (problem) return errors.badRequest(problem)
  const campuses = new Set((await prisma.campus.findMany({ where: { id: { in: [...d.campusIds, ...d.pay.map((p) => p.campusId)] } }, select: { id: true } })).map((c) => c.id))
  await prisma.$transaction([
    prisma.user.update({ where: { id: t.userId }, data: { allLocations: !!d.allLocations } }),
    prisma.userPlaceAccess.deleteMany({ where: { userId: t.userId } }),
    prisma.userPlaceAccess.createMany({ data: d.campusIds.filter((c) => campuses.has(c)).map((campusId) => ({ userId: t.userId, campusId, createdById: session.user.id })) }),
    prisma.teacherPlacePay.deleteMany({ where: { teacherId: id } }),
    prisma.teacherPlacePay.createMany({ data: d.pay.filter((p) => campuses.has(p.campusId) && (p.fixed != null || p.percent != null || p.perSession != null)).map((p) => ({ teacherId: id, campusId: p.campusId, fixedAmount: p.fixed, percentOfStudentPayment: p.percent, perSessionAmount: p.perSession })) }),
    prisma.teacherEmployment.deleteMany({ where: { teacherId: id } }),
    prisma.teacherEmployment.createMany({ data: d.employment.map((e) => ({ teacherId: id, employer: e.employer, partnerName: e.partnerName || null, kind: e.kind, fromDate: new Date(e.fromDate), toDate: e.toDate ? new Date(e.toDate) : null, note: e.note || null, createdById: session.user.id })) }),
  ])
  forgetPlaces(t.userId)
  return successResponse({ saved: true })
}
