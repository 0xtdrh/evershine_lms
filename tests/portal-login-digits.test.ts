import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { looksLikePhone, phoneVariants, toLatinDigits } from '@/lib/portal-login'

describe('parent login with Arabic digits (final test X05)', () => {
  it('Arabic-Indic and Persian digits become 0-9', () => {
    expect(toLatinDigits('٠١٠٠١٢٣٤٥٦١')).toBe('01001234561')
    expect(toLatinDigits('۰۱۰۰۱۲۳۴۵۶۱')).toBe('01001234561')
  })
  it('an Arabic-digit phone is a phone and has the usual variants', () => {
    expect(looksLikePhone('٠١٠٠١٢٣٤٥٦١')).toBe(true)
    expect(phoneVariants('٠١٠٠ ١٢٣ ٤٥٦١')).toContain('01001234561')
    expect(phoneVariants('٠١٠٠١٢٣٤٥٦١')).toContain('+201001234561')
  })
  it('an email is not a phone', () => {
    expect(looksLikePhone('a@b.com')).toBe(false)
  })
})
