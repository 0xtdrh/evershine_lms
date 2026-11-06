import { describe, expect, it } from 'vitest'
import { passwordProblem, safeCell } from '@/lib/security/password-policy'

describe('password rules', () => {
  it('staff need 10 characters with letters and numbers', () => {
    expect(passwordProblem('ADMIN', 'Abc12345')?.en).toContain('10')
    expect(passwordProblem('SECRETARY', 'abcdefghijk')?.en).toContain('letters and numbers')
    expect(passwordProblem('TEACHER', '12345678901')?.en).toContain('letters and numbers')
    expect(passwordProblem('SUPER_ADMIN', 'TechNova2026')).toBeNull()
    expect(passwordProblem('ACCOUNTANT', 'كلمةسر12345')).toBeNull()
  })
  it('families need 8', () => {
    expect(passwordProblem('PARENT', 'abc1234')?.en).toContain('8')
    expect(passwordProblem('GUARDIAN', 'abcd1234')).toBeNull()
    expect(passwordProblem('STUDENT', 'onlyletters')).toBeNull()
  })
  it('one repeated character is refused', () => {
    expect(passwordProblem('PARENT', 'aaaaaaaaaa')?.en).toContain('easy')
  })
  it('an unknown role is treated as staff', () => {
    expect(passwordProblem(null, 'abc12345')?.en).toContain('10')
  })
})

describe('spreadsheet cells', () => {
  it('a cell that looks like a formula becomes text', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`)
    expect(safeCell('+201000')).toBe(`'+201000`)
    expect(safeCell('-5')).toBe(`'-5`)
    expect(safeCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
  })
  it('normal text is untouched', () => {
    expect(safeCell('Ahmed')).toBe('Ahmed')
    expect(safeCell(null)).toBe('')
    expect(safeCell(42)).toBe('42')
  })
})
