import { describe, expect, it } from 'vitest'
import { generateTempPassword, portalMessage, whatsappNumber } from '@/lib/students/portal-password'

describe('generateTempPassword', () => {
  it('builds Word-1234-Word with two different words', () => {
    const seq = [5, 5, 3, 42]
    let i = 0
    const pw = generateTempPassword(() => seq[i++ % seq.length])
    expect(pw).toMatch(/^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/)
    const [a, , b] = pw.split('-')
    expect(a).not.toBe(b)
  })

  it('pads the number to 4 digits', () => {
    const vals = [0, 1, 7]
    let i = 0
    expect(generateTempPassword(() => vals[i++])).toMatch(/-0007-/)
  })
})

describe('whatsappNumber', () => {
  it.each([
    ['01012345678', '201012345678'],
    ['+20 101 234 5678', '201012345678'],
    ['00201012345678', '201012345678'],
    ['201012345678', '201012345678'],
  ])('%s -> %s', (input, out) => expect(whatsappNumber(input)).toBe(out))

  it('rejects empty or local-looking junk', () => {
    expect(whatsappNumber('')).toBeNull()
    expect(whatsappNumber(null)).toBeNull()
    expect(whatsappNumber('0123')).toBeNull()
  })
})

describe('portalMessage', () => {
  it('contains the link, the login and the password', () => {
    const m = portalMessage({ target: 'guardian', studentName: 'Ali', loginId: '01012345678', password: 'Kite-1234-Ruby', loginUrl: 'https://x/login' })
    expect(m).toContain('https://x/login')
    expect(m).toContain('01012345678')
    expect(m).toContain('Kite-1234-Ruby')
  })
})
