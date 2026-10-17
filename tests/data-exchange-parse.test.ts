import { existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { checkPermission } from '@/lib/rbac'
import { DATASETS, datasetByKey, exchangeRights, importFields } from '@/lib/data-exchange/registry'
import { headerText, matchHeaders, parseSchedule, readCell, readSheet, toDate, toPhone } from '@/lib/data-exchange/parse'

const students = datasetByKey('students')!

describe('import / export registry', () => {
  it('every dataset has Arabic, a real page and unique field keys', () => {
    for (const d of DATASETS) {
      expect(d.ar && d.descAr, d.key).toBeTruthy()
      expect(existsSync(join('app', d.page.split('?')[0], 'page.tsx')), `${d.key} → ${d.page}`).toBe(true)
      const keys = d.fields.map((f) => f.key)
      expect(new Set(keys).size, d.key).toBe(keys.length)
      for (const f of d.fields) expect(f.ar, `${d.key}.${f.key}`).toBeTruthy()
      if (d.canImport) expect(d.importPerm, d.key).toBeTruthy()
    }
  })
  it('rights follow the 4-level permissions (data_export / data_import + the table permission)', () => {
    const can = (role: string) => (r: Parameters<typeof checkPermission>[1], a: Parameters<typeof checkPermission>[2]) => checkPermission(role, r, a)
    expect(exchangeRights(students, can('ADMIN'))).toEqual({ export: true, import: true })
    expect(exchangeRights(students, can('SECRETARY')).import).toBe(false) // no data_import by default
    expect(exchangeRights(students, can('TEACHER')).export).toBe(false)
    expect(exchangeRights(datasetByKey('invoices')!, can('ADMIN')).import).toBe(false) // export-only table
  })
})

describe('reading Excel cells', () => {
  it('dates: ISO, day-first, Excel serial, Date objects, Arabic digits', () => {
    expect(toDate('2015-03-21')).toBe('2015-03-21')
    expect(toDate('21/03/2015')).toBe('2015-03-21')
    expect(toDate('٢١/٠٣/٢٠١٥')).toBe('2015-03-21')
    expect(toDate(42084)).toBe('2015-03-21')
    expect(toDate(new Date(Date.UTC(2015, 2, 21)))).toBe('2015-03-21')
    expect(toDate('31/02/2015')).toBeNull()
  })
  it('phones: lost leading zero, +20, spaces, Arabic digits', () => {
    expect(toPhone(1001234567)).toBe('01001234567')
    expect(toPhone('+20 100 123 4567')).toBe('01001234567')
    expect(toPhone('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567')
    expect(toPhone('12')).toBeNull()
  })
  it('enum in Arabic or English, ref by name inside the places, clear bilingual errors', () => {
    const gender = students.fields.find((f) => f.key === 'gender')!
    expect(readCell(gender, 'أنثى', {}).value).toBe('FEMALE')
    expect(readCell(gender, 'male', {}).value).toBe('MALE')
    const campus = students.fields.find((f) => f.key === 'campus')!
    const refs = { campus: [{ id: 'c1', name: 'الكوثر' }, { id: 'c2', name: 'Sheraton Center' }] }
    expect(readCell(campus, 'sheraton  center', refs).value).toBe('c2')
    const miss = readCell(campus, 'Dahar', refs)
    expect(miss.error?.ar).toContain('مش موجود في أماكنك')
    expect(readCell(students.fields.find((f) => f.key === 'firstName')!, '', {}).error?.ar).toContain('مطلوب')
  })
  it('headers match the template text, the English or the Arabic name', () => {
    const f = importFields(students)
    expect(matchHeaders([headerText(f[0]), 'Last name', 'الاسم الرباعي بالعربي', 'something else'], f)).toEqual(['firstName', 'lastName', 'fullNameAr', null])
  })
  it('a sheet: empty rows skipped, missing required columns reported, row numbers kept', () => {
    const f = importFields(datasetByKey('courseStructure')!)
    const sheet = [f.map(headerText), ['Robotics', 'NovaBuilders', '', 'Level 1', 1, 8, 1, 'شهري', 850], [], ['Robotics', 'NovaBuilders', '', 'Level 2', 'x', 8, 1, 'monthly', 850]]
    const r = readSheet(sheet, f, {})
    expect(r.rows.map((x) => [x.row, x.errors.length])).toEqual([[2, 0], [4, 1]])
    expect(r.rows[0].values).toMatchObject({ track: 'Robotics', pricing: 'MONTHLY', price: 850 })
    expect(readSheet([['Track']], f, {}).missingColumns.map((x) => x.key)).toContain('course')
  })
  it('group schedules in English or Arabic', () => {
    expect(parseSchedule('Sun 16:00, Wed 4:30 pm').slots).toEqual([{ dayOfWeek: 0, time: '16:00' }, { dayOfWeek: 3, time: '16:30' }])
    expect(parseSchedule('الأحد 16:00، الأربعاء ٤:٣٠ م').slots).toEqual([{ dayOfWeek: 0, time: '16:00' }, { dayOfWeek: 3, time: '16:30' }])
    expect(parseSchedule('someday 99').error).toBe(true)
  })
})
