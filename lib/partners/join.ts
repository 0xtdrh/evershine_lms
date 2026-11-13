/**
 * Six phases 1-C (2026-11-13): a partner's join code + sign-up link /join/p/<code>. A family that signs up with it is tied to
 * the partner (Guardian.partnerId): its booking options include the partner's places, groups and prices, and the partner
 * share (phase 5) can count it. Codes are short and easy to type: the partner's name letters + 3 characters.
 */

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { makeCode, normalizeCode } from '@/lib/site/codes'

export function joinCodeFor(name: string, random: (max: number) => number = randomInt): string {
  const letters = name.toUpperCase().normalize('NFKD').replace(/[^A-Z]/g, '').slice(0, 6) || 'TN'
  return makeCode(letters, random, 3)
}

/** Makes (or makes a new) join code. `fresh` replaces the old one: the old link stops working. */
export async function ensureJoinCode(partnerId: string, fresh = false) {
  const p = await prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true, joinCode: true } })
  if (!p) return null
  if (p.joinCode && !fresh) return p.joinCode
  for (let i = 0; i < 20; i++) {
    const code = joinCodeFor(p.name)
    try {
      await prisma.partner.update({ where: { id: partnerId }, data: { joinCode: code, joinActive: true } })
      return code
    } catch { /* taken: try another */ }
  }
  return null
}

/** The active partner behind a join code (null when unknown or switched off). */
export async function partnerByJoinCode(raw: string | null | undefined) {
  const code = raw ? normalizeCode(raw) : ''
  if (!code) return null
  const p = await prisma.partner.findUnique({ where: { joinCode: code }, select: { id: true, name: true, isActive: true, joinActive: true } })
  return p && p.isActive && p.joinActive ? { id: p.id, name: p.name } : null
}

export async function joinStats(partnerId: string) {
  const families = (await prisma.guardian.findMany({ where: { partnerId }, select: { id: true } })).map((g) => g.id)
  const [bookings, confirmed] = await Promise.all([
    prisma.courseBooking.count({ where: { guardianId: { in: families } } }),
    prisma.courseBooking.count({ where: { guardianId: { in: families }, status: 'CONFIRMED' } }),
  ])
  return { accounts: families.length, bookings, confirmed }
}
