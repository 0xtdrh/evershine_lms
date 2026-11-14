import { describe, expect, it } from 'vitest'
import { localizeMessage } from '@/lib/i18n/api-messages'

describe('localizeMessage (final test 14/11)', () => {
  const pair = 'This group waits for its minimum (1/3). It starts when complete · الجروب مستني اكتمال العدد (1/3)'

  it('keeps only the screen language of an "English · عربي" pair', () => {
    expect(localizeMessage(pair, 'ar')).toBe('الجروب مستني اكتمال العدد (1/3)')
    expect(localizeMessage(pair, 'en')).toBe('This group waits for its minimum (1/3). It starts when complete')
  })

  it('works with the Arabic side first', () => {
    expect(localizeMessage('اتلغى · This group was cancelled by staff', 'en')).toBe('This group was cancelled by staff')
  })

  it('leaves labels joined with · alone (no sentence on the English side)', () => {
    expect(localizeMessage('مريم · Explorer 1 A', 'en')).toBe('مريم · Explorer 1 A')
  })

  it('translates the common English-only messages for Arabic screens', () => {
    expect(localizeMessage('You do not have permission to perform this action', 'ar')).toMatch(/صلاحياتك/)
    expect(localizeMessage('Group not found', 'ar')).toMatch(/مش لاقيين/)
    expect(localizeMessage('Not your group', 'ar')).toBe('الدرس ده مش من جروبك.')
  })

  it('never touches English screens or unknown messages', () => {
    expect(localizeMessage('You do not have permission to perform this action', 'en')).toBe('You do not have permission to perform this action')
    expect(localizeMessage('Something specific failed', 'ar')).toBe('Something specific failed')
    expect(localizeMessage('', 'ar')).toBe('')
  })
})
