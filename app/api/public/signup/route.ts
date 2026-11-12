/**
 * POST /api/public/signup — six phases 1-a: the website sign-up steps send here (no login).
 * Makes one ADMISSION REQUEST per student (the same requests the online application makes), carrying the course page,
 * the way (live online / recorded), the chosen online group, the code and the payment reference, so staff approve them
 * in the Admissions screen with every existing rule (registration number, family by phone, portal logins, group seats,
 * first invoice). An enrolment code is checked and its uses are taken now; it becomes a discount on approval.
 */

import { NextRequest } from 'next/server'
import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors } from '@/lib/api-response'
import { HOUR, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { cairoToday } from '@/lib/dates/cairo'
import { publicCatalog } from '@/lib/site/courses-store'
import { lookupCode, useCode } from '@/lib/site/codes-store'
import { PROBLEM_TEXT } from '@/lib/site/codes'
import { ageOnDay, contactPhone, MIN_SELF_AGE, signupSchema } from '@/lib/site/signup'
import { normalizePhone } from '@/lib/site/request-rules'
import { notifyUsers } from '@/lib/notifications/events'

const bad = (en: string, ar: string) => errors.badRequest(`${en} · ${ar}`)

export async function POST(request: NextRequest) {
  const ip = requestIp(request)
  const limited = await rateLimit(`signup:ip:${ip}`, 5, HOUR)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const parsed = signupSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  if (v.website) return createdResponse({ ok: true, ref: 'ok', count: 0 }, 'Sent')

  const course = (await publicCatalog({ slug: v.listing }))[0]
  if (!course) return bad('This course is not open for sign-up', 'الكورس ده مش متاح للتسجيل')
  if (v.mode === 'ONLINE' && !course.modes.online) return bad('Live online is not open for this course', 'اللايف أونلاين مش متاح للكورس ده')
  if (v.mode === 'RECORDED' && !course.modes.recorded) return bad('The recorded course is not open', 'الكورس المسجل مش متاح')
  const group = v.mode === 'ONLINE' && v.groupId ? course.onlineGroups.find((g) => g.id === v.groupId) : null
  if (v.mode === 'ONLINE' && v.groupId && !group) return bad('This group time is not available', 'الميعاد ده مش متاح')

  const today = cairoToday()
  if (v.who === 'SELF' && ageOnDay(v.students[0].dob, today) < MIN_SELF_AGE) return bad(`Signing up alone is from age ${MIN_SELF_AGE}`, `التسجيل لوحدك من سن ${MIN_SELF_AGE}`)
  for (const s of v.students) {
    const age = ageOnDay(s.dob, today)
    if (age < 3 || age > 80) return bad('Check the date of birth', 'راجع تاريخ الميلاد')
  }

  const phone = contactPhone(v)!
  let codeId: string | null = null
  let codeText: string | null = null
  if (v.code) {
    const { code, row, res } = await lookupCode(v.code, v.listing, phone)
    if (!res.ok) return errors.badRequest(`${PROBLEM_TEXT[res.problem!].en} · ${PROBLEM_TEXT[res.problem!].ar}`)
    if (row!.maxUses != null && row!.maxUses - row!.uses < v.students.length) return bad('This code is not enough for every student', 'الكود ده مش كفاية لكل الطلاب')
    codeId = row!.id
    codeText = code
  }

  const online = v.mode === 'ONLINE' ? await prisma.campus.findFirst({ where: { kind: 'ONLINE', isActive: true }, select: { id: true } }) : null
  const existingFamily = !!(await prisma.guardian.findUnique({ where: { phoneNumber: phone }, select: { id: true } }))
  const ref = `W${Date.now().toString(36).toUpperCase()}${randomInt(1000)}`
  const parent = v.who === 'PARENT' ? v.parent! : null
  const ids: string[] = []
  for (const s of v.students) {
    const req = await prisma.admissionRequest.create({
      data: {
        firstName: s.firstName, lastName: s.lastName, fatherName: parent ? parent.firstName : s.lastName,
        dateOfBirth: new Date(`${s.dob}T00:00:00Z`), gender: s.gender, address: `${v.city}, ${v.country}`, city: v.city, country: v.country,
        phoneNumber: v.who === 'SELF' ? phone : phone, emergencyContact: phone, email: v.who === 'SELF' ? v.selfEmail || null : parent?.email || null,
        guardianFirstName: parent?.firstName ?? null, guardianLastName: parent?.lastName ?? null, guardianPhoneNumber: parent ? phone : null,
        guardianEmail: parent?.email || null, guardianRelationship: parent?.relation || null,
        schoolName: s.school || null, priorProgrammingExperience: s.experience || null,
        preferredCampusId: online?.id ?? null, preferredClassSectionId: group?.id ?? null, deliveryMode: v.mode === 'ONLINE' ? 'ONLINE' : 'PHYSICAL',
        sourceOfInfo: 'WEBSITE', referralCode: v.referral || null, termsAccepted: true, termsAcceptedAt: new Date(),
        selfSignup: v.who === 'SELF', signupRef: ref, signupListing: v.listing, signupMode: v.mode, signupCode: codeText,
        paymentRef: v.paymentRef || null, visitSessionId: v.sid || null,
        hasSiblingAtAcademy: v.students.length > 1 || existingFamily,
        adminComments: existingFamily ? 'Website sign-up from a phone already in the system (existing family) · رقم مسجل قبل كده' : null,
      },
      select: { id: true },
    })
    ids.push(req.id)
    if (codeId && !(await useCode(codeId, phone, req.id))) return bad('The code ran out while sending', 'الكود خلص وانت بتسجّل')
  }

  try {
    const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'SECRETARY'] } }, select: { id: true } })
    const who = `${v.students.map((s) => s.firstName).join('، ')} · ${normalizePhone(phone)}`
    await notifyUsers(staff.map((u) => u.id), 'WEBSITE_REQUEST', {
      title: `New website sign-up: ${course.title.en} (${v.mode === 'ONLINE' ? 'live online' : 'recorded'})`, message: who,
      titleAr: `تسجيل جديد من الموقع: ${course.title.ar} (${v.mode === 'ONLINE' ? 'لايف أونلاين' : 'مسجل'})`, messageAr: who, relatedId: ids[0],
    })
  } catch (e) {
    console.warn('[SIGNUP_NOTIFY]', e)
  }
  return createdResponse({ ok: true, ref, count: ids.length, existingFamily }, 'Sent')
}
