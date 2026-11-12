import { describe, it, expect } from 'vitest'
import { bothSides, itemSchema, youtubeEmbed } from '@/lib/site/items'

describe('x01 website items', () => {
  it('a category must belong to its kind; a title is needed in at least one language', () => {
    expect(itemSchema.safeParse({ kind: 'PRODUCT', category: 'EDUCATIONAL', titleEn: '', titleAr: 'كيت' }).success).toBe(true)
    expect(itemSchema.safeParse({ kind: 'PRODUCT', category: 'COMPETITION', titleEn: 'Kit', titleAr: '' }).success).toBe(false)
    expect(itemSchema.safeParse({ kind: 'MEDIA', category: 'VIDEO', titleEn: '', titleAr: '' }).success).toBe(false)
  })
  it('links must be web links', () => {
    expect(itemSchema.safeParse({ kind: 'MEDIA', category: 'VIDEO', titleEn: 'A', titleAr: 'أ', videoUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(itemSchema.safeParse({ kind: 'MEDIA', category: 'VIDEO', titleEn: 'A', titleAr: 'أ', videoUrl: 'https://youtu.be/abcDEF12345' }).success).toBe(true)
  })
  it('an empty language borrows the other; YouTube links become embeds', () => {
    expect(bothSides('', 'كيت')).toEqual({ en: 'كيت', ar: 'كيت' })
    expect(youtubeEmbed('https://www.youtube.com/watch?v=abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345')
    expect(youtubeEmbed('https://youtube.com/shorts/abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345')
    expect(youtubeEmbed('https://example.com/video.mp4')).toBeNull()
  })
})
