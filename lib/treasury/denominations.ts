/**
 * Daily cash count helper (owner suggestion K, 18/11): count the notes by kind and the total is worked out.
 * Egyptian pound notes and coins. Pure.
 */

export const EGP_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25] as const

/** pieces per denomination → total (rounded to piasters). Bad / negative counts are ignored. */
export function denominationTotal(pieces: Record<string, string | number | undefined>): number {
  let total = 0
  for (const d of EGP_DENOMINATIONS) {
    const n = Number(pieces[String(d)] ?? 0)
    if (Number.isFinite(n) && n > 0) total += Math.floor(n) * d
  }
  return Math.round(total * 100) / 100
}

/** counted − expected, rounded; positive = more cash than the system expects. */
export function countDifference(expected: number, counted: number): number {
  return Math.round((counted - expected) * 100) / 100
}
