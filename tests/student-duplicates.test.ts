import { describe, expect, it } from 'vitest'
import { duplicateLevel, normName, normPhone } from '@/lib/students/duplicates'

const old = { firstName: 'أحمد', lastName: 'محمد', dateOfBirth: new Date('2016-05-10'), phones: ['01012345678'] }

describe('duplicate-student warning', () => {
  it('names: hamza, ta marbuta, alef maqsura, case and spaces do not matter', () => {
    expect(normName('أحمد')).toBe(normName('احمد'))
    expect(normName('إسراء')).toBe(normName('اسراء'))
    expect(normName('فاطمة')).toBe(normName('فاطمه'))
    expect(normName('مصطفى')).toBe(normName('مصطفي'))
    expect(normName('  Youssef   ALI ')).toBe('youssef ali')
  })
  it('phones: +20 / 0020 / missing 0 / Arabic digits are the same number', () => {
    for (const p of ['+201012345678', '00201012345678', '1012345678', '٠١٠١٢٣٤٥٦٧٨', '010-1234-5678']) expect(normPhone(p)).toBe('01012345678')
  })
  it('same name + same parent phone, or same name + same birth date = the same child', () => {
    expect(duplicateLevel({ firstName: 'احمد', lastName: 'محمد', phones: ['+201012345678'] }, old)).toBe('SURE')
    expect(duplicateLevel({ firstName: 'أحمد', lastName: 'محمد', dateOfBirth: '2016-05-10', phones: [] }, old)).toBe('SURE')
  })
  it('same first name + same parent phone (last name typed another way) = very likely', () => {
    expect(duplicateLevel({ firstName: 'أحمد', lastName: 'محمد علي', phones: ['01012345678'] }, old)).toBe('LIKELY')
  })
  it('same full name only = possible (staff decide)', () => {
    expect(duplicateLevel({ firstName: 'أحمد', lastName: 'محمد', dateOfBirth: '2017-01-01', phones: ['01199999999'] }, old)).toBe('POSSIBLE')
  })
  it('a brother or sister (same parent phone, another first name) is never a match', () => {
    expect(duplicateLevel({ firstName: 'مريم', lastName: 'محمد', phones: ['01012345678'] }, old)).toBeNull()
    expect(duplicateLevel({ firstName: 'أحمد', lastName: 'حسن', phones: ['01199999999'] }, old)).toBeNull()
  })
})
