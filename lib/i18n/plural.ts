/**
 * Arabic counts (owner 21/11: "6 طالب" must be "6 طلاب"). Egyptian rule: 1 → singular, 2 → dual,
 * 3-10 → plural, 11+ → singular again. Pure; use for any "number + noun" in an Arabic message.
 */

export interface ArNoun { one: string; two: string; few: string }

export const AR_NOUN = {
  student: { one: 'طالب', two: 'طالبين', few: 'طلاب' },
  session: { one: 'حصة', two: 'حصتين', few: 'حصص' },
  day: { one: 'يوم', two: 'يومين', few: 'أيام' },
  month: { one: 'شهر', two: 'شهرين', few: 'شهور' },
  group: { one: 'جروب', two: 'جروبين', few: 'جروبات' },
  invoice: { one: 'فاتورة', two: 'فاتورتين', few: 'فواتير' },
  room: { one: 'قاعة', two: 'قاعتين', few: 'قاعات' },
  hour: { one: 'ساعة', two: 'ساعتين', few: 'ساعات' },
} satisfies Record<string, ArNoun>

/** "6 طلاب", "2 طالبين", "12 طالب", "1 طالب" (the number is part of the text). */
export function arCount(n: number, noun: ArNoun): string {
  const k = Math.abs(Math.trunc(n))
  if (k === 2) return `${n} ${noun.two}`
  if (k >= 3 && k <= 10) return `${n} ${noun.few}`
  return `${n} ${noun.one}`
}
