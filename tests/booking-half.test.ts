import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { half } from '@/lib/bookings/engine'

describe('booking messages in one language (C05)', () => {
  it('splits "English · عربي"', () => {
    expect(half('Not paid in time · مادفعش في الميعاد', 'en')).toBe('Not paid in time')
    expect(half('Not paid in time · مادفعش في الميعاد', 'ar')).toBe('مادفعش في الميعاد')
    expect(half('only one language', 'ar')).toBe('only one language')
    expect(half(null, 'en')).toBeNull()
  })
})
