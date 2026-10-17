/**
 * Phase 6: the Excel side of import / export (ExcelJS, server only).
 * - template: sheet "Data" with bilingual headers (required in gold), dropdowns for choices and for the person's own
 *   branches / groups / levels (from a hidden "Lists" sheet), and an "Instructions" sheet with the TechNova logo.
 * - readWorkbook: the first sheet → plain cells (the header row is found automatically).
 * - exportWorkbook: the branded report (logo, navy header, zebra rows) in English or Arabic (right-to-left).
 * - failuresWorkbook: the rows that were not imported with the reason, ready to fix and upload again.
 * The old `xlsx` library is not used here (it has an advisory for reading untrusted files).
 */

import ExcelJS from 'exceljs'
import { addBrandLogo, LOGO_PLACEMENT } from '@/lib/excel/brand-logo'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'
import { codeLabel, exportFields, importFields, type DatasetDef, type FieldDef } from './registry'
import { headerText, matchHeaders, type Cell, type RefLists } from './parse'

const NAVY = 'FF1B4F8A'
const GOLD = 'FFF5A623'
const PALE_GOLD = 'FFFFF4DC'

const colLetter = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

export async function templateWorkbook(d: DatasetDef, refs: RefLists, lang: 'en' | 'ar'): Promise<ExcelJS.Workbook> {
  const ar = lang === 'ar'
  const fields = importFields(d)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TechNova Management'
  const sheet = wb.addWorksheet(ar ? 'البيانات' : 'Data', { views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }] })
  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' })

  sheet.columns = fields.map((f) => ({ header: headerText(f), key: f.key, width: Math.max(16, Math.min(40, headerText(f).length + 2)) }))
  const head = sheet.getRow(1)
  head.height = 32
  head.eachCell((cell, i) => {
    const f = fields[i - 1]
    cell.font = { bold: true, color: { argb: f.required ? 'FF3D2B00' : 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.required ? GOLD : NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.note = [ar ? f.ar : f.en, f.required ? (ar ? 'مطلوب' : 'Required') : (ar ? 'اختياري' : 'Optional'), (ar ? f.hintAr : f.hintEn) ?? '', f.example ? `${ar ? 'مثال' : 'Example'}: ${f.example}` : ''].filter(Boolean).join('\n')
  })

  // dropdowns: choices and the person's own places / groups / levels
  let listCol = 0
  fields.forEach((f, i) => {
    const values = f.type === 'enum' ? (f.options ?? []).map((o) => (ar ? o.ar : o.en))
      : f.type === 'bool' ? (ar ? ['نعم', 'لا'] : ['Yes', 'No'])
      : f.type === 'ref' && f.ref ? (refs[f.ref] ?? []).map((r) => r.name)
      : null
    if (!values?.length) return
    listCol++
    values.forEach((v, r) => { lists.getCell(r + 1, listCol).value = v })
    const range = `Lists!$${colLetter(listCol)}$1:$${colLetter(listCol)}$${values.length}`
    for (let r = 2; r <= 1001; r++) {
      sheet.getCell(r, i + 1).dataValidation = {
        type: 'list', allowBlank: !f.required, formulae: [range], showErrorMessage: f.type !== 'ref',
        errorTitle: ar ? 'قيمة مش من القايمة' : 'Not in the list', error: ar ? 'اختار من القايمة' : 'Choose from the list',
      }
    }
  })
  // phone / id / date columns as text so Excel keeps leading zeros and our date format
  fields.forEach((f, i) => { if (['phone', 'date'].includes(f.type) || f.key === 'nationalId') sheet.getColumn(i + 1).numFmt = '@' })

  // instructions
  const help = wb.addWorksheet(ar ? 'التعليمات' : 'Instructions', { views: [{ rightToLeft: ar }] })
  help.getColumn(1).width = 30; help.getColumn(2).width = 14; help.getColumn(3).width = 60; help.getColumn(4).width = 28
  help.mergeCells(1, 1, 1, 4)
  const t = help.getCell(1, 1)
  t.value = `TechNova — ${ar ? d.ar : d.en}`
  t.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  help.getRow(1).height = 40
  const logo = await addBrandLogo(wb)
  if (logo !== null) help.addImage(logo, { tl: { col: 0, row: 0 }, ext: LOGO_PLACEMENT.crest })
  const lines = [
    ar ? d.descAr : d.descEn,
    (ar ? d.importNoteAr : d.importNoteEn) ?? '',
    ar ? 'املا شيت «البيانات» سطر لكل صف. الأعمدة الدهبي مطلوبة. ماتغيّرش أول سطر (العناوين).' : 'Fill the "Data" sheet, one line per row. Gold columns are required. Do not change the first line (headers).',
    ar ? 'التواريخ: سنة-شهر-يوم أو يوم/شهر/سنة. التليفون: 01xxxxxxxxx.' : 'Dates: YYYY-MM-DD or DD/MM/YYYY. Phones: 01xxxxxxxxx.',
    ar ? 'ارفع الملف من «الاستيراد والتصدير» — هتشوف كل الأخطاء قبل ما حاجة تتحفظ.' : 'Upload it from "Import & Export" — you see every problem before anything is saved.',
  ].filter(Boolean)
  lines.forEach((l, i) => { help.mergeCells(i + 3, 1, i + 3, 4); const c = help.getCell(i + 3, 1); c.value = l; c.alignment = { wrapText: true, vertical: 'top' }; help.getRow(i + 3).height = 30 })
  const top = lines.length + 4
  const cols = ar ? ['العمود', 'مطلوب؟', 'ملاحظة / القيم المسموحة', 'مثال'] : ['Column', 'Required?', 'Note / allowed values', 'Example']
  cols.forEach((c, i) => { const cell = help.getCell(top, i + 1); cell.value = c; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } } })
  fields.forEach((f: FieldDef, i) => {
    const r = top + 1 + i
    const allowed = f.options ? f.options.map((o) => (ar ? o.ar : o.en)).join(' / ') : f.ref ? (ar ? 'اختار من القايمة في الخانة' : 'choose from the list in the cell') : ''
    help.getCell(r, 1).value = headerText(f)
    help.getCell(r, 2).value = f.required ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')
    help.getCell(r, 3).value = [(ar ? f.hintAr : f.hintEn) ?? '', allowed].filter(Boolean).join(' — ')
    help.getCell(r, 4).value = f.example ?? ''
    if (f.required) help.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE_GOLD } }
  })
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  return wb
}

const plain = (v: ExcelJS.CellValue): Cell => {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string }
  if (o.richText) return o.richText.map((x) => x.text).join('')
  if (o.text !== undefined) return String(o.text)
  if (o.result !== undefined) return o.result as Cell
  return String(v)
}

/** The uploaded file → rows of plain cells; the header row is the first row that matches at least 2 columns. */
export async function readWorkbook(buf: ArrayBuffer, d: DatasetDef): Promise<{ rows: Cell[][]; headerRowIndex: number } | null> {
  const wb = new ExcelJS.Workbook()
  try { await wb.xlsx.load(buf) } catch { return null }
  const fields = importFields(d)
  for (const sheet of wb.worksheets) {
    if (sheet.state !== 'visible' || sheet.name === 'Lists') continue
    const rows: Cell[][] = []
    sheet.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: Cell[] = []
      for (let c = 1; c <= Math.max(fields.length + 5, row.cellCount); c++) cells.push(plain(row.getCell(c).value))
      rows[n - 1] = cells
    })
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (matchHeaders(rows[i] ?? [], fields).filter(Boolean).length >= 2) return { rows: rows.map((r) => r ?? []), headerRowIndex: i }
    }
  }
  return { rows: [], headerRowIndex: -1 }
}

export async function exportWorkbook(d: DatasetDef, rows: Record<string, unknown>[], lang: 'en' | 'ar', subtitle?: string): Promise<ExcelJS.Workbook> {
  const ar = lang === 'ar'
  const fields = exportFields(d)
  const fmt = (f: FieldDef, v: unknown) => {
    if (v === null || v === undefined) return ''
    if (f.type === 'bool') return v ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')
    if (f.type === 'enum') { const o = f.options?.find((x) => x.value === v); return o ? (ar ? o.ar : o.en) : String(v) }
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return codeLabel(v, ar) as string | number
  }
  const wb = await createBrandedWorkbook({
    title: `${ar ? d.ar : d.en} (${rows.length})`,
    subtitle,
    sheetName: (ar ? d.ar : d.en).slice(0, 31),
    columns: fields.map((f) => ({ header: ar ? f.ar : f.en, key: f.key, width: f.type === 'text' ? 24 : 16, forceText: f.type === 'phone' })),
    rows: rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, fmt(f, r[f.key])]))),
  })
  if (ar) wb.worksheets.forEach((s) => { s.views = [{ ...(s.views?.[0] ?? {}), rightToLeft: true } as ExcelJS.WorksheetView] })
  return wb
}

/** Rows that were not imported, with the reason first — fix them and upload again. */
export async function failuresWorkbook(d: DatasetDef, rows: { row: number; values: Record<string, unknown>; reason: string }[], lang: 'en' | 'ar') {
  const ar = lang === 'ar'
  const fields = importFields(d)
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet(ar ? 'البيانات' : 'Data', { views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }] })
  sheet.columns = [{ header: ar ? 'السبب | Reason' : 'Reason | السبب', key: '_reason', width: 50 }, { header: ar ? 'السطر | Row' : 'Row | السطر', key: '_row', width: 8 },
    ...fields.map((f) => ({ header: headerText(f), key: f.key, width: 20 }))]
  sheet.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } } })
  for (const r of rows) sheet.addRow({ _reason: r.reason, _row: r.row, ...Object.fromEntries(fields.map((f) => [f.key, r.values[f.key] ?? ''])) })
  sheet.getColumn(1).eachCell((c, n) => { if (n > 1) c.font = { color: { argb: 'FFB91C1C' } } })
  return wb
}

export async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer())
}
