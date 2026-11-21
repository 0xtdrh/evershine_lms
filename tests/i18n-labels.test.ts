import { describe, expect, it } from 'vitest'
import { cycleLabel, invoiceStatusText } from '@/lib/i18n/labels'

describe('stored labels in Arabic (final test 18/11)', () => {
  it('invoice titles', () => {
    expect(cycleLabel('NovaBuilders — Level 2 — Month 1', 'ar')).toBe('NovaBuilders — المستوى 2 — الشهر 1')
    expect(cycleLabel('NovaBuilders — Level 2 — Month 1', 'en')).toBe('NovaBuilders — Level 2 — Month 1')
    expect(cycleLabel(null, 'ar')).toBe('')
  })
  it('invoice statuses never show a raw code', () => {
    expect(invoiceStatusText('ISSUED', 'ar')).toBe('لسه مادفعتش')
    expect(invoiceStatusText('PARTIALLY_PAID', 'en')).toBe('Partly paid')
    expect(invoiceStatusText('SOMETHING_NEW', 'en')).toBe('something new')
  })
})
