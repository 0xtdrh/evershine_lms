/**
 * Partners part 1 (2026-10-16): the price of one cycle of a group.
 * Order ("the most specific wins"): the group's own price → the place's price for that level (PlacePrice) → the level price.
 * A group without names (unnamedHeadcount) still has a price, but its money normally comes from the partner deal.
 */

import { prisma } from '@/lib/prisma'

interface LevelPrice { id: string; pricingType: string; monthlyPrice: unknown; fullLevelPrice: unknown }

/** Pure: pick the price from the three levels. */
export function pickCyclePrice(level: LevelPrice, place: { monthlyPrice: unknown; fullLevelPrice: unknown } | null, groupOverride: unknown): number {
  if (groupOverride !== null && groupOverride !== undefined && Number(groupOverride) >= 0) return Number(groupOverride)
  const monthly = level.pricingType === 'MONTHLY'
  const fromPlace = place ? (monthly ? place.monthlyPrice : place.fullLevelPrice) : null
  if (fromPlace !== null && fromPlace !== undefined) return Number(fromPlace)
  return Number((monthly ? level.monthlyPrice : level.fullLevelPrice) ?? 0)
}

/** The cycle price for a group of `level` in `campusId` (groupOverride = the group's own price, if any). */
export async function cyclePrice(level: LevelPrice, campusId: string, groupOverride: unknown = null): Promise<number> {
  if (groupOverride !== null && groupOverride !== undefined) return pickCyclePrice(level, null, groupOverride)
  const place = await prisma.placePrice.findUnique({ where: { campusId_levelId: { campusId, levelId: level.id } }, select: { monthlyPrice: true, fullLevelPrice: true } })
  return pickCyclePrice(level, place, null)
}
