/**
 * a02 M1 batch 1b (2026-10-31) — which curriculum of a level a group reads. Pure (tests/delivery-modes.test.ts).
 * A level has its MAIN curriculum and maybe other curricula (CurriculumVariant): same sessions / price, different
 * content, meant for some places (a partner, the online place…) and / or some ways (branch / online / recorded).
 * The group's own choice wins ("MAIN" = the main one); otherwise the curriculum that fits the group's place and way best:
 * place match counts 2, way match 1; a curriculum limited to other places / ways never fits; one with no limits at all
 * is only used when chosen by hand. Nothing fits → the main curriculum (null).
 */

import { cleanModes, type Mode } from './modes'

export const MAIN_VARIANT = 'MAIN'

export interface VariantRow { id: string; modes: unknown; campusIds: unknown; sortOrder?: number }

const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === 'string') : null)

export function pickVariant(variants: VariantRow[], ctx: { campusId: string | null; mode: Mode; chosen?: string | null }): string | null {
  if (ctx.chosen === MAIN_VARIANT) return null
  if (ctx.chosen && variants.some((v) => v.id === ctx.chosen)) return ctx.chosen
  let best: { id: string; score: number; order: number } | null = null
  for (const v of variants) {
    const places = ids(v.campusIds)
    const modes = cleanModes(v.modes)
    if (!places && !modes) continue
    if (places && (!ctx.campusId || !places.includes(ctx.campusId))) continue
    if (modes && !modes.includes(ctx.mode)) continue
    const score = (places ? 2 : 0) + (modes ? 1 : 0)
    const order = v.sortOrder ?? 0
    if (!best || score > best.score || (score === best.score && order < best.order)) best = { id: v.id, score, order }
  }
  return best?.id ?? null
}

/** The way a group is taught, until every session has its own way (batch 2): the online place = ONLINE, else BRANCH. */
export const groupMode = (campusKind: string | null | undefined): Mode => (campusKind === 'ONLINE' ? 'ONLINE' : 'BRANCH')
