import { describe, expect, it } from 'vitest'
import { webUrl, safeHref } from '@/lib/validation/web-url'

describe('web links only (security part 1)', () => {
  it('refuses script and data links', () => {
    expect(webUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(webUrl.safeParse('JaVaScRiPt:alert(1)').success).toBe(false)
    expect(webUrl.safeParse('data:text/html,<b>x</b>').success).toBe(false)
    expect(webUrl.safeParse('https://drive.google.com/x').success).toBe(true)
  })
  it('drops a bad stored link when showing it', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref(' https://maps.app.goo.gl/x ')).toBe('https://maps.app.goo.gl/x')
    expect(safeHref(null)).toBeUndefined()
  })
})
