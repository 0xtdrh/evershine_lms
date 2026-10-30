import { describe, expect, it } from 'vitest'
import { codeFromName, keyFromTitle, uniqueCode } from '@/lib/ids/auto-code'
import { cleanModes, effectiveModes, isOffered, modesText } from '@/lib/delivery/modes'

describe('teaching modes — allowed ways', () => {
  it('cleans stored values', () => {
    expect(cleanModes(['ONLINE', 'BRANCH', 'ONLINE', 'X'])).toEqual(['BRANCH', 'ONLINE'])
    expect(cleanModes([])).toBeNull()
    expect(cleanModes(null)).toBeNull()
    expect(cleanModes('BRANCH')).toBeNull()
  })
  it('the closest setting wins; nothing set = every way', () => {
    expect(effectiveModes({})).toEqual({ modes: ['BRANCH', 'ONLINE', 'RECORDED'], from: 'DEFAULT' })
    expect(effectiveModes({ track: ['BRANCH'] })).toEqual({ modes: ['BRANCH'], from: 'TRACK' })
    expect(effectiveModes({ track: ['BRANCH'], course: ['ONLINE', 'BRANCH'] })).toEqual({ modes: ['BRANCH', 'ONLINE'], from: 'COURSE' })
    expect(effectiveModes({ track: ['BRANCH'], level: ['RECORDED'], session: ['BRANCH'] })).toEqual({ modes: ['BRANCH'], from: 'SESSION' })
    expect(effectiveModes({ course: [], level: null, track: ['ONLINE'] })).toEqual({ modes: ['ONLINE'], from: 'TRACK' })
  })
  it('reads well in both languages', () => {
    expect(modesText(['BRANCH', 'ONLINE'], 'ar')).toBe('في الفرع أو لايف أونلاين')
    expect(modesText(['BRANCH', 'ONLINE', 'RECORDED'], 'en')).toBe('Every way')
  })
})

describe('teaching modes — where an item is offered', () => {
  it('no limits = everywhere', () => {
    expect(isOffered({}, 'A')).toBe(true)
    expect(isOffered({ track: [], course: null }, 'A')).toBe(true)
  })
  it('a level needs its course and track to be offered there too', () => {
    expect(isOffered({ level: ['A'] }, 'A')).toBe(true)
    expect(isOffered({ level: ['A'] }, 'B')).toBe(false)
    expect(isOffered({ track: ['P1'], level: null }, 'P2')).toBe(false) // partner 1's own track
    expect(isOffered({ track: ['P1', 'A'], course: ['A'] }, 'P1')).toBe(false)
  })
  it('no place given (company-wide list) shows everything', () => {
    expect(isOffered({ track: ['P1'] }, null)).toBe(true)
  })
})

describe('course code filled in from the name', () => {
  it('initials for several words, first letters for one word, Arabic written in Latin', () => {
    expect(codeFromName('Python for Kids')).toBe('PFK')
    expect(codeFromName('Robotics')).toBe('ROBO')
    expect(codeFromName('روبوتكس')).toBe('RWBW')
    expect(codeFromName('  ')).toBe('CRS')
  })
  it('never repeats a code', () => {
    expect(uniqueCode('ROBO', ['robo', 'ROBO2'])).toBe('ROBO3')
    expect(uniqueCode('PFK', [])).toBe('PFK')
  })
})

describe('branch code and agreement key filled in too', () => {
  it('a branch code keeps to 5 characters, number included', () => {
    expect(uniqueCode(codeFromName('El Kawther Branch'), [], 5)).toBe('EKB')
    expect(uniqueCode('HURGH', ['HURGH', 'HURG2'], 5)).toBe('HURG3')
  })
  it('an agreement key is small letters and dashes, never repeated', () => {
    expect(keyFromTitle('Refund Policy')).toBe('refund-policy')
    expect(keyFromTitle('Refund Policy', ['refund-policy'])).toBe('refund-policy-2')
  })
})
