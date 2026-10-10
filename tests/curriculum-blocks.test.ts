import { describe, expect, it } from 'vitest'
import { hostAllowed, moveInOrder, nextStatus, validateBlockData, videoEmbedUrl, visibleTo } from '@/lib/curriculum/blocks'

describe('curriculum blocks (LMS L1)', () => {
  it('turns YouTube / Vimeo links into embed links', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toContain('/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toContain('/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbedUrl('https://example.com/video.mp4')).toBeNull()
    expect(videoEmbedUrl('not a url')).toBeNull()
  })

  it('embeds only allowed https sites', () => {
    expect(hostAllowed('https://scratch.mit.edu/projects/1/embed')).toBe(true)
    expect(hostAllowed('https://www.tinkercad.com/embed/abc')).toBe(true)
    expect(hostAllowed('https://wokwi.com/projects/1')).toBe(true)
    expect(hostAllowed('http://scratch.mit.edu/projects/1')).toBe(false)
    expect(hostAllowed('https://evil.com/?x=scratch.mit.edu')).toBe(false)
    expect(hostAllowed('https://scratch.mit.edu.evil.com/')).toBe(false)
  })

  it('validates block data per type', () => {
    expect(validateBlockData('TEXT', { textEn: 'Hi' }).ok).toBe(true)
    expect(validateBlockData('NOPE', {}).ok).toBe(false)
    expect(validateBlockData('LINK', { url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(validateBlockData('LINK', { url: 'http://x.com' }).ok).toBe(false)
    expect(validateBlockData('LINK', { url: 'https://x.com' }).ok).toBe(true)
    expect(validateBlockData('EMBED', { url: 'https://evil.com/x' }).ok).toBe(false)
    expect(validateBlockData('EMBED', { url: 'https://scratch.mit.edu/projects/1/embed' }).ok).toBe(true)
    expect(validateBlockData('VIDEO', {}).ok).toBe(false)
    expect(validateBlockData('VIDEO', { url: 'https://youtu.be/dQw4w9WgXcQ' }).ok).toBe(true)
    expect(validateBlockData('VIDEO', { media: { publicId: 'x/y', resourceType: 'video' } }).ok).toBe(true)
    expect(validateBlockData('IMAGE', {}).ok).toBe(false)
    expect(validateBlockData('QUIZ', { note: 'later' }).ok).toBe(false) // L4: a real quiz now needs questions
    expect(validateBlockData('QUIZ', { questions: [{ id: 'a', type: 'TRUE_FALSE', correct: ['true'] }] }).ok).toBe(true)
    expect(validateBlockData('H5P', { note: 'later' }).ok).toBe(true)
  })

  it('drops unknown fields such as a signed media link sent back by the editor', () => {
    const r = validateBlockData('IMAGE', { media: { publicId: 'a', resourceType: 'image' }, mediaUrl: 'https://res.cloudinary.com/x' })
    expect(r.ok).toBe(true)
    expect((r.data as Record<string, unknown>).mediaUrl).toBeUndefined()
  })

  it('hides instructor-only content from students', () => {
    expect(visibleTo('INSTRUCTOR', 'STUDENT')).toBe(false)
    expect(visibleTo('BOTH', 'STUDENT')).toBe(true)
    expect(visibleTo('STUDENT', 'STUDENT')).toBe(true)
    expect(visibleTo('INSTRUCTOR', 'INSTRUCTOR')).toBe(true)
  })

  it('follows the edition status machine', () => {
    expect(nextStatus('DRAFT', 'submit', false)).toBe('IN_REVIEW')
    expect(nextStatus('IN_REVIEW', 'submit', true)).toBeNull()
    expect(nextStatus('IN_REVIEW', 'publish', false)).toBeNull()
    expect(nextStatus('IN_REVIEW', 'publish', true)).toBe('PUBLISHED')
    expect(nextStatus('DRAFT', 'publish', true)).toBe('PUBLISHED')
    expect(nextStatus('IN_REVIEW', 'reject', true)).toBe('DRAFT')
    expect(nextStatus('PUBLISHED', 'archive', true)).toBe('ARCHIVED')
    expect(nextStatus('ARCHIVED', 'publish', true)).toBeNull()
  })

  it('moves items up and down', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'x', 'up')).toEqual(['a', 'b', 'c'])
  })
})
