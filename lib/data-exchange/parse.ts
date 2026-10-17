/**
 * Phase 6: reading an uploaded Excel row — match the header to a column, turn each cell into a clean value and say
 * (in English + Arabic) what is wrong. Pure: the Excel file itself is read in lib/data-exchange/excel.ts.
 * Forgiving on purpose: Arabic digits, dates as DD/MM/YYYY or Excel dates, phones that lost their leading 0,
 * enum cells in English or Arabic, branch / group names with different spacing or hamza.
 */

import type { FieldDef } from './registry'

export type Cell = string | number | boolean | Date | null | undefined
export interface RowError { field: string | null; en: string; ar: string }
export interface RefItem { id: string; name: string; aliases?: string[] }
export type RefLists = Partial<Record<NonNullable<FieldDef['ref']>, RefItem[]>>

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
export const westernDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))

/** For name matching: lower case, no extra spaces, Arabic letters normalised a little. */
export const normName = (s: string) =>
  westernDigits(s).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').replace(/[\s_\-–—·]+/g, ' ').trim()

/** The header text in the template: "First name * | الاسم الأول". */
export const headerText = (f: FieldDef) => `${f.en}${f.required ? ' *' : ''} | ${f.ar}`

/** Which field each header cell belongs to (null = unknown column, ignored). */
export function matchHeaders(headers: Cell[], fields: FieldDef[]): (string | null)[] {
  return headers.map((h) => {
    const text = normName(String(h ?? '').replace(/\*/g, ''))
    if (!text) return null
    const parts = text.split('|').map((p) => p.trim()).filter(Boolean)
    const f = fields.find((x) => parts.some((p) => p === normName(x.en) || p === normName(x.ar) || p === normName(x.key)))
    return f?.key ?? null
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** A date cell → YYYY-MM-DD (or null). */
export function toDate(raw: Cell): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate())
  if (typeof raw === 'number' && raw > 59 && raw < 80000) {
    // Excel serial date (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000)
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = westernDigits(String(raw ?? '')).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) return ymd(+m[3], +m[2], +m[1]) // day first (Egypt)
  return null
}

/** A phone cell → digits with the leading 0 (Excel often drops it); +20 / 0020 → 0. */
export function toPhone(raw: Cell): string | null {
  let s = westernDigits(typeof raw === 'number' ? String(Math.round(raw)) : String(raw ?? '')).replace(/[^\d+]/g, '')
  if (s.startsWith('+20')) s = `0${s.slice(3)}`
  else if (s.startsWith('0020')) s = `0${s.slice(4)}`
  else if (s.startsWith('20') && s.length === 12) s = `0${s.slice(2)}`
  s = s.replace(/^\+/, '')
  if (/^1\d{9}$/.test(s)) s = `0${s}` // Excel turned 010… into 10…
  return /^\d{10,15}$/.test(s) ? s : null
}

export function toNumber(raw: Cell): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = westernDigits(String(raw ?? '')).replace(/[,\s٬]/g, '').replace('٫', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function toBool(raw: Cell): boolean | null {
  if (typeof raw === 'boolean') return raw
  const s = normName(String(raw ?? ''))
  if (['yes', 'y', 'true', '1', 'نعم', 'اه', 'ايوه'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'لا', 'لأ'].includes(s)) return false
  return null
}

const isEmpty = (raw: Cell) => raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')

/** One cell → its clean value, or an error in both languages. */
export function readCell(f: FieldDef, raw: Cell, refs: RefLists): { value: unknown; error?: RowError } {
  const err = (en: string, ar: string) => ({ value: null, error: { field: f.key, en: `${f.en}: ${en}`, ar: `${f.ar}: ${ar}` } })
  if (isEmpty(raw)) return f.required ? err('required', 'مطلوب') : { value: null }
  switch (f.type) {
    case 'text': {
      const v = String(raw instanceof Date ? toDate(raw) : raw).trim()
      return { value: v }
    }
    case 'number': {
      const n = toNumber(raw)
      return n === null ? err('must be a number', 'لازم يكون رقم') : { value: n }
    }
    case 'date': {
      const d = toDate(raw)
      return d ? { value: d } : err('date not understood (use YYYY-MM-DD or DD/MM/YYYY)', 'التاريخ مش مفهوم (اكتبه سنة-شهر-يوم أو يوم/شهر/سنة)')
    }
    case 'phone': {
      const p = toPhone(raw)
      return p ? { value: p } : err('phone number not valid', 'رقم التليفون مش صحيح')
    }
    case 'email': {
      const v = String(raw).trim().toLowerCase()
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v } : err('email not valid', 'الإيميل مش صحيح')
    }
    case 'bool': {
      const b = toBool(raw)
      return b === null ? err('write yes or no', 'اكتب نعم أو لا') : { value: b }
    }
    case 'enum': {
      const s = normName(String(raw))
      const o = (f.options ?? []).find((x) => [x.value, x.en, x.ar].some((t) => normName(t) === s))
      return o ? { value: o.value } : err(`choose one of: ${(f.options ?? []).map((x) => x.en).join(', ')}`, `اختار من: ${(f.options ?? []).map((x) => x.ar).join('، ')}`)
    }
    case 'ref': {
      const s = normName(String(raw))
      const list = (f.ref && refs[f.ref]) || []
      const hits = list.filter((x) => normName(x.name) === s || (x.aliases ?? []).some((a) => normName(a) === s))
      if (hits.length === 1) return { value: hits[0].id }
      if (hits.length > 1) return err(`"${raw}" matches more than one — write it exactly as in the list`, `"${raw}" بيطابق أكتر من واحد — اكتبه زي القايمة بالظبط`)
      return err(`"${raw}" not found in your places`, `"${raw}" مش موجود في أماكنك`)
    }
  }
}

export interface ParsedRow { row: number; values: Record<string, unknown>; errors: RowError[] }

/** A whole sheet (header + data rows) → checked rows. Fully empty rows are skipped. */
export function readSheet(rows: Cell[][], fields: FieldDef[], refs: RefLists, headerRowIndex = 0): { rows: ParsedRow[]; missingColumns: FieldDef[]; unknownColumns: string[] } {
  const header = rows[headerRowIndex] ?? []
  const keys = matchHeaders(header, fields)
  const missingColumns = fields.filter((f) => f.required && !keys.includes(f.key))
  const unknownColumns = header.map((h, i) => (keys[i] ? null : String(h ?? '').trim())).filter((x): x is string => !!x)
  const out: ParsedRow[] = []
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const cells = rows[r] ?? []
    if (cells.every(isEmpty)) continue
    const values: Record<string, unknown> = {}
    const errors: RowError[] = []
    for (const f of fields) {
      const i = keys.indexOf(f.key)
      const { value, error } = readCell(f, i >= 0 ? cells[i] : undefined, refs)
      if (error) errors.push(error)
      else if (value !== null) values[f.key] = value
    }
    out.push({ row: r + 1, values, errors })
  }
  return { rows: out, missingColumns, unknownColumns }
}

/** "Sun 16:00, Wed 16:00" / "الأحد 16:00، الأربعاء 4:30م" → [{dayOfWeek, time}] (0 = Sunday). */
export function parseSchedule(text: string): { slots: { dayOfWeek: number; time: string }[]; error: boolean } {
  const DAY: Record<string, number> = {
    sun: 0, sunday: 0, 'الاحد': 0, 'احد': 0,
    mon: 1, monday: 1, 'الاثنين': 1, 'الاتنين': 1, 'اثنين': 1,
    tue: 2, tuesday: 2, 'الثلاثاء': 2, 'التلات': 2, 'الثلاث': 2,
    wed: 3, wednesday: 3, 'الاربعاء': 3, 'الاربع': 3,
    thu: 4, thursday: 4, 'الخميس': 4,
    fri: 5, friday: 5, 'الجمعه': 5,
    sat: 6, saturday: 6, 'السبت': 6,
  }
  const parts = westernDigits(text).split(/[,،;؛\n]+/).map((p) => p.trim()).filter(Boolean)
  const slots: { dayOfWeek: number; time: string }[] = []
  for (const p of parts) {
    const m = p.match(/^(.+?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م)?$/i)
    if (!m) return { slots: [], error: true }
    const day = DAY[normName(m[1])]
    let h = +m[2]
    const min = m[3] ? +m[3] : 0
    const ap = (m[4] ?? '').toLowerCase()
    if ((ap === 'pm' || ap === 'م') && h < 12) h += 12
    if ((ap === 'am' || ap === 'ص') && h === 12) h = 0
    if (day === undefined || h > 23 || min > 59) return { slots: [], error: true }
    slots.push({ dayOfWeek: day, time: `${pad(h)}:${pad(min)}` })
  }
  return { slots, error: false }
}
