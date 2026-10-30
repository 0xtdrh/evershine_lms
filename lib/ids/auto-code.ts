/**
 * 2026-10-30 (owner): every code the system asks for (course code, branch code, agreement key) is filled in
 * automatically from the name and can still be changed.
 * Pure (tests/delivery-modes.test.ts). Arabic names are written in Latin letters; the code is unique (2, 3… added).
 */

const AR: Record<string, string> = {
  'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': '', 'ب': 'B', 'ت': 'T', 'ث': 'TH', 'ج': 'G', 'ح': 'H', 'خ': 'KH', 'د': 'D',
  'ذ': 'Z', 'ر': 'R', 'ز': 'Z', 'س': 'S', 'ش': 'SH', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z', 'ع': 'A', 'غ': 'GH', 'ف': 'F',
  'ق': 'K', 'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H', 'ة': 'A', 'و': 'W', 'ي': 'Y', 'ى': 'A', 'ئ': 'Y', 'ؤ': 'W',
}

const latin = (word: string) => [...word].map((ch) => AR[ch] ?? ch).join('').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** "Python for Kids" → "PFK", "Robotics" → "ROBO", "روبوتكس" → "RWBW". */
export function codeFromName(name: string): string {
  const words = name.trim().split(/\s+/).map(latin).filter(Boolean)
  let code = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4)
  if (code.length < 2 && words[0]) code = words[0].slice(0, 4)
  return code.length >= 2 ? code : 'CRS'
}

/** The first free code: CODE, CODE2, CODE3… (at most maxLen characters, the number included). */
export function uniqueCode(base: string, taken: Iterable<string>, maxLen = 20): string {
  const used = new Set([...taken].map((c) => c.toUpperCase()))
  const b = base.toUpperCase().slice(0, maxLen) || 'CRS'
  if (!used.has(b)) return b
  for (let i = 2; ; i++) {
    const n = String(i)
    const c = `${b.slice(0, maxLen - n.length)}${n}`
    if (!used.has(c)) return c
  }
}

/** A key like "refund-policy" from a title (small letters, numbers, dashes; Arabic written in Latin). */
export function keyFromTitle(title: string, taken: Iterable<string> = []): string {
  const words = title.trim().split(/\s+/).map((w) => [...w].map((ch) => AR[ch] ?? ch).join('').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean)
  const base = (words.join('-') || 'item').slice(0, 36)
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}
