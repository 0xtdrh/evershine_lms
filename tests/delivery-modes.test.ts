import { describe, expect, it } from 'vitest'
import { codeFromName, keyFromTitle, uniqueCode } from '@/lib/ids/auto-code'
import { cleanModes, effectiveModes, isOffered, modesText } from '@/lib/delivery/modes'
import { groupMode, pickVariant } from '@/lib/delivery/variants'
import { applyTemplate, cleanPattern, firstNotAllowed, patternText, templateFor } from '@/lib/delivery/templates'

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

describe('which curriculum a group reads', () => {
  const v = [
    { id: 'online', modes: ['ONLINE'], campusIds: null },
    { id: 'nour', modes: null, campusIds: ['P1'] },
    { id: 'nourOnline', modes: ['ONLINE'], campusIds: ['P1'] },
    { id: 'spare', modes: null, campusIds: null },
  ]
  it('the place and the way decide; place counts more', () => {
    expect(pickVariant(v, { campusId: 'A', mode: 'BRANCH' })).toBeNull() // main
    expect(pickVariant(v, { campusId: 'A', mode: 'ONLINE' })).toBe('online')
    expect(pickVariant(v, { campusId: 'P1', mode: 'BRANCH' })).toBe('nour')
    expect(pickVariant(v, { campusId: 'P1', mode: 'ONLINE' })).toBe('nourOnline')
  })
  it('the group own choice wins; MAIN forces the main one; an unknown choice is ignored', () => {
    expect(pickVariant(v, { campusId: 'P1', mode: 'BRANCH', chosen: 'spare' })).toBe('spare')
    expect(pickVariant(v, { campusId: 'P1', mode: 'BRANCH', chosen: 'MAIN' })).toBeNull()
    expect(pickVariant(v, { campusId: 'A', mode: 'ONLINE', chosen: 'gone' })).toBe('online')
  })
  it('the online place teaches online', () => {
    expect(groupMode('ONLINE')).toBe('ONLINE')
    expect(groupMode('PARTNER')).toBe('BRANCH')
  })
})

describe('templates of ways', () => {
  it('fills the weekly slots in week order and repeats', () => {
    const slots = [{ dayOfWeek: 2, time: '18:00' }, { dayOfWeek: 0, time: '16:00' }, { dayOfWeek: 4, time: '17:00' }]
    expect(applyTemplate(slots, ['ONLINE', 'BRANCH']).map((s) => `${s.dayOfWeek} ${s.mode}`)).toEqual(['0 ONLINE', '2 BRANCH', '4 ONLINE'])
  })
  it('cleans patterns, finds a way that is not allowed, picks the level template first', () => {
    expect(cleanPattern(['RECORDED', 'X', 'BRANCH'])).toEqual(['RECORDED', 'BRANCH'])
    expect(cleanPattern([])).toBeNull()
    expect(firstNotAllowed([{ dayOfWeek: 0, time: '1', mode: 'ONLINE' }, { dayOfWeek: 1, time: '1' }], ['ONLINE'])).toEqual({ dayOfWeek: 1, time: '1' })
    expect(templateFor({ deliveryTemplateId: null }, { deliveryTemplateId: 'c' })).toBe('c')
    expect(templateFor({ deliveryTemplateId: 'l' }, { deliveryTemplateId: 'c' })).toBe('l')
    expect(patternText(['RECORDED', 'RECORDED', 'RECORDED', 'BRANCH'], 'ar')).toBe('1 فرع + 3 مسجلة')
  })
})
