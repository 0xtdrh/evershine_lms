/** x01: which website numbers to show (pure; used by the page and the tests). */

import type { StatSource } from './content'

export type SiteStats = Record<StatSource, number>

/** A live number below its minimum is left out; a fixed number always shows; a hidden one never does. */
export function shownStats(items: { source?: StatSource; value?: number; min?: number; show?: boolean }[], stats: SiteStats | null) {
  return items.flatMap((s, i) => {
    if (s.show === false) return []
    if (s.value != null) return [{ i, value: s.value }]
    if (!s.source || !stats) return []
    const v = stats[s.source]
    return v >= (s.min ?? 0) ? [{ i, value: v }] : []
  })
}
