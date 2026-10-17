import { existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { GUIDE, SECTIONS_FOR_ROLE, sectionsFor } from '@/lib/guide/content'

describe('user guide', () => {
  it('every link opens a real page', () => {
    for (const s of GUIDE) for (const st of s.steps) {
      if (!st.href) continue
      const path = st.href.split('?')[0].replace(/^\/dashboard/, 'app/dashboard')
      expect(existsSync(`${path}/page.tsx`), `${s.key}: ${st.title} → ${st.href}`).toBe(true)
    }
  })
  it('each role sees its own section, admins see every section', () => {
    expect(sectionsFor('TEACHER').map((s) => s.key)).toEqual(['TEACHER', 'FAQ'])
    expect(sectionsFor('PARENT').map((s) => s.key)).toEqual(['PARENT', 'FAQ'])
    expect(sectionsFor('ADMIN')).toHaveLength(GUIDE.length)
    for (const keys of Object.values(SECTIONS_FOR_ROLE)) for (const k of keys) expect(GUIDE.some((s) => s.key === k)).toBe(true)
  })
})
