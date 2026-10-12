/**
 * P2 profile of one student.
 * GET [?view=recap|portfolio] — the profile / the yearly recap / the portfolio data.
 * POST { action, ... } — goal | diary | thanks | moment | experience | sign (upload signature) | upload | interest.
 */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { goalSchema, EXPERIENCE_ROLES } from '@/lib/profile/rules'
import {
  addDiary, addExperience, addGoal, addMoment, addUpload, levelInterest, portfolioData, profileView, recap, sendThanks, uploadSignature, type Outcome,
} from '@/lib/profile/engine'

export const dynamic = 'force-dynamic'

const media = z.object({ publicId: z.string().min(1).max(300), resourceType: z.enum(['image', 'video']), format: z.string().max(10).optional(), bytes: z.number().optional(), duration: z.number().optional() })

async function who() {
  const session = await auth()
  if (!session?.user) return null
  return { id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }
}

const answer = (r: Outcome<unknown>) =>
  r.ok ? successResponse(r.value ?? { ok: true }) : r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : r.code === 'NOT_FOUND' ? errors.notFound(r.message ?? 'Not found') : errors.badRequest(r.message ?? 'Not possible')

export async function GET(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const { studentId } = await params
  const view = new URL(req.url).searchParams.get('view')
  const data = view === 'recap' ? await recap(user, studentId) : view === 'portfolio' ? await portfolioData(user, studentId) : await profileView(user, studentId)
  if (!data) return errors.forbidden()
  return successResponse(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const { studentId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  switch (body?.action) {
    case 'goal': {
      const p = goalSchema.safeParse(body)
      if (!p.success) return errors.validation(p.error)
      return answer(await addGoal(user, studentId, p.data as Parameters<typeof addGoal>[2]))
    }
    case 'diary': {
      const p = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(body)
      return p.success ? answer(await addDiary(user, studentId, p.data.text!)) : errors.validation(p.error)
    }
    case 'thanks': {
      const p = z.object({ toStudentId: z.string().min(1), text: z.string().trim().min(1).max(300) }).safeParse(body)
      return p.success ? answer(await sendThanks(user, studentId, p.data.toStudentId!, p.data.text!)) : errors.validation(p.error)
    }
    case 'moment': {
      const p = z.object({ title: z.string().trim().min(1).max(160), note: z.string().max(500).nullish(), takenAt: z.string().nullish(), media: media.nullish() }).safeParse(body)
      return p.success ? answer(await addMoment(user, studentId, p.data as Parameters<typeof addMoment>[2])) : errors.validation(p.error)
    }
    case 'experience': {
      const p = z.object({ role: z.enum(EXPERIENCE_ROLES), titleEn: z.string().max(120).nullish(), titleAr: z.string().max(120).nullish(), from: z.string().min(8), to: z.string().nullish() }).safeParse(body)
      return p.success ? answer(await addExperience(user, studentId, p.data as Parameters<typeof addExperience>[2])) : errors.validation(p.error)
    }
    case 'sign':
      return answer(await uploadSignature(user, studentId, body.forMoment === true))
    case 'upload': {
      const p = z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(500).nullish(), groupId: z.string().nullish(), media }).safeParse(body)
      return p.success ? answer(await addUpload(user, studentId, p.data as Parameters<typeof addUpload>[2])) : errors.validation(p.error)
    }
    case 'interest': {
      const p = z.object({ levelId: z.string().min(1) }).safeParse(body)
      return p.success ? answer(await levelInterest(user, studentId, p.data.levelId!)) : errors.validation(p.error)
    }
    default:
      return errors.badRequest('Unknown action')
  }
}
