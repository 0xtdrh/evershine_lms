/**
 * Parent contact log (phase A, docs/design-phase-a.md): calls, WhatsApp,
 * meetings, visits — and messages the system sent (channel SYSTEM, auto).
 * Server-only.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

export const CONTACT_CHANNELS = ['CALL', 'WHATSAPP', 'MEETING', 'VISIT', 'SYSTEM'] as const
export const CONTACT_REASONS = ['PAYMENT', 'ABSENCE', 'BEHAVIOUR', 'LEVEL', 'RENEWAL', 'COMPLAINT', 'OTHER'] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]
export type ContactReason = (typeof CONTACT_REASONS)[number]

export interface LogContactInput {
  studentId: string
  guardianId?: string | null
  channel: ContactChannel
  reason: ContactReason
  summary: string
  direction?: 'OUT' | 'IN'
  followUpAt?: Date | null
  auto?: boolean
  userId?: string | null
}

export async function logContact(input: LogContactInput, db: Db = prisma) {
  const student = await db.student.findUnique({ where: { id: input.studentId }, select: { campusId: true } })
  if (!student) throw new Error('Student not found')
  return db.contactLog.create({
    data: {
      studentId: input.studentId,
      guardianId: input.guardianId ?? null,
      campusId: student.campusId,
      channel: input.channel,
      direction: input.direction ?? 'OUT',
      reason: input.reason,
      summary: input.summary.slice(0, 5000),
      followUpAt: input.followUpAt ?? null,
      auto: !!input.auto,
      createdById: input.userId ?? null,
    },
  })
}

/** For messages the system sends: must never break the main action. */
export async function logSystemContact(input: Omit<LogContactInput, 'auto'>) {
  try {
    await logContact({ ...input, auto: true })
  } catch (err) {
    console.error('[CONTACT_LOG_AUTO]', err)
  }
}

/** Display names for the people who logged contacts (staff accounts). */
export async function staffNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const [users, admins, teachers] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
    prisma.admin.findMany({ where: { userId: { in: ids } }, select: { userId: true, firstName: true, lastName: true } }),
    prisma.teacher.findMany({ where: { userId: { in: ids } }, select: { userId: true, firstName: true, lastName: true } }),
  ])
  const m = new Map(users.map((u) => [u.id, u.email]))
  for (const p of [...admins, ...teachers]) m.set(p.userId, `${p.firstName} ${p.lastName}`.trim())
  return m
}

/** Last contact date per student (for the students list). */
export async function lastContactByStudent(studentIds: string[]): Promise<Map<string, Date>> {
  if (!studentIds.length) return new Map()
  const rows = await prisma.contactLog.groupBy({
    by: ['studentId'],
    where: { studentId: { in: studentIds } },
    _max: { createdAt: true },
  })
  return new Map(rows.filter((r) => r._max.createdAt).map((r) => [r.studentId, r._max.createdAt!]))
}
