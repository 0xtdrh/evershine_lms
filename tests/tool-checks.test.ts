import { describe, expect, it } from 'vitest'
import { analyzeAppInventor, analyzeArduino, analyzeMakecode, analyzeScratch, analyzeSnap, evaluateRules, parseToolLink, type ToolCheck } from '@/lib/assignments/tool-checks'
import { assignmentDataSchema, autoMax, similarity, totalMax } from '@/lib/assignments/rules'

const scratch = {
  targets: [
    { isStage: true, blocks: { a: { opcode: 'event_whenflagclicked' } } },
    { isStage: false, blocks: { b: { opcode: 'control_forever' }, c: { opcode: 'control_if' }, d: { opcode: 'sound_playuntildone' }, e: { opcode: 'motion_movesteps' } } },
    { isStage: false, blocks: { f: { opcode: 'data_setvariableto' }, g: { opcode: 'event_broadcast' } } },
  ],
}

describe('L3 batch 2 — tool project checks', () => {
  it('Scratch: sprites, blocks, loop, condition, sound, variable, broadcast, a given block', () => {
    const f = analyzeScratch(scratch)
    expect([f.sprites, f.blocks]).toEqual([2, 7])
    const c: ToolCheck = { tool: 'SCRATCH', rules: [
      { id: '1', kind: 'SPRITES_MIN', value: 2, points: 2 }, { id: '2', kind: 'HAS_LOOP', points: 1 }, { id: '3', kind: 'HAS_CONDITION', points: 1 },
      { id: '4', kind: 'HAS_SOUND', points: 1 }, { id: '5', kind: 'HAS_VARIABLE', points: 1 }, { id: '6', kind: 'HAS_BROADCAST', points: 1 },
      { id: '7', kind: 'USES_BLOCK', value: 'motion_movesteps', points: 1 }, { id: '8', kind: 'HAS_KEY_EVENT', points: 3 }, { id: '9', kind: 'SPRITES_MIN', value: 3, points: 2 },
    ] }
    const r = evaluateRules(c, f)
    expect([r.score, r.max]).toEqual([8, 13])
    expect(r.detail.filter((d) => !d.ok).map((d) => d.id)).toEqual(['8', '9'])
  })

  it('MakeCode text', () => {
    const f = analyzeMakecode('let x = 0\ninput.onButtonPressed(Button.A, function () { basic.showNumber(x) })\nbasic.forever(function () { if (input.lightLevel() > 100) { x += 1 } })')
    const c: ToolCheck = { tool: 'MAKECODE', rules: ['HAS_LOOP', 'HAS_CONDITION', 'HAS_VARIABLE', 'USES_BUTTON', 'USES_LED', 'USES_SENSOR'].map((k, i) => ({ id: String(i), kind: k, points: 1 })) }
    expect(evaluateRules(c, f).score).toBe(6)
    expect(evaluateRules({ tool: 'MAKECODE', rules: [{ id: 'a', kind: 'USES_TEXT', value: 'showNumber', points: 1 }] }, f).score).toBe(1)
  })

  it('App Inventor screens, components and blocks', () => {
    const f = analyzeAppInventor({
      'src/a/Screen1.scm': '#|\n$JSON\n{"Properties":{"$Type":"Form","$Components":[{"$Type":"Button"},{"$Type":"Image"}]}}\n|#',
      'src/a/Screen2.scm': '#|\n$JSON\n{"Properties":{"$Type":"Form","$Components":[{"$Type":"Sound"}]}}\n|#',
      'src/a/Screen1.bky': '<xml><block type="component_event"></block><block type="controls_if"></block><block type="global_declaration"></block></xml>',
    })
    expect([f.screens, f.blocks]).toEqual([2, 3])
    const r = evaluateRules({ tool: 'APPINVENTOR', rules: [{ id: '1', kind: 'COMPONENT', value: 'Button', points: 1 }, { id: '2', kind: 'HAS_CONDITION', points: 1 }, { id: '3', kind: 'HAS_VARIABLE', points: 1 }, { id: '4', kind: 'HAS_LOOP', points: 1 }, { id: '5', kind: 'SCREENS_MIN', value: 2, points: 1 }] }, f)
    expect(r.detail.map((d) => d.ok)).toEqual([true, true, true, false, true])
  })

  it('Snap! XML', () => {
    const f = analyzeSnap('<project><sprites><sprite name="A"><scripts><script><block s="receiveGo"/><block s="doForever"/><block s="doIf"/></script></scripts></sprite></sprites></project>')
    expect([f.sprites, f.blocks]).toEqual([1, 3])
    expect(evaluateRules({ tool: 'SNAP', rules: [{ id: '1', kind: 'HAS_LOOP', points: 1 }, { id: '2', kind: 'HAS_CONDITION', points: 1 }, { id: '3', kind: 'HAS_VARIABLE', points: 1 }] }, f).score).toBe(2)
  })

  it('Arduino text checks: setup/loop, brackets (ignoring comments and strings), functions', () => {
    const good = analyzeArduino('// blink\nvoid setup() { pinMode(13, OUTPUT); }\nvoid loop() {\n  digitalWrite(13, HIGH); delay(500); // "{"\n  if (x > 1) { Serial.println("}"); }\n}')
    expect(good.balanced).toBe(true)
    expect(good.names.has('setup+loop')).toBe(true)
    expect(good.names.has('digitalwrite')).toBe(true)
    const bad = analyzeArduino('void setup() { pinMode(13, OUTPUT);\nvoid loop() { }')
    expect(bad.balanced).toBe(false)
    expect(analyzeArduino('void setup(){}').names.has('setup+loop')).toBe(false)
    const r = evaluateRules({ tool: 'ARDUINO', rules: [{ id: '1', kind: 'USES_FUNCTION', value: 'digitalWrite', points: 2 }, { id: '2', kind: 'HAS_CONDITION', points: 1 }] }, good)
    expect(r.score).toBe(3)
  })

  it('reads tool links', () => {
    expect(parseToolLink('https://scratch.mit.edu/projects/10128407/')).toEqual({ tool: 'SCRATCH', id: '10128407' })
    expect(parseToolLink('https://makecode.microbit.org/_Ae4h8H3dJ1rX')).toEqual({ tool: 'MAKECODE', id: '_Ae4h8H3dJ1rX' })
    expect(parseToolLink('https://snap.berkeley.edu/project?username=ali&projectname=Robot')).toEqual({ tool: 'SNAP', id: 'Robot', owner: 'ali' })
    expect(parseToolLink('https://github.com/technova/robot-car')).toEqual({ tool: 'GITHUB', id: 'robot-car', owner: 'technova' })
    expect(parseToolLink('http://scratch.mit.edu/projects/1234')).toBeNull()
    expect(parseToolLink('https://evil.com/projects/1234')).toBeNull()
  })
})

describe('L3 batch 2 — code assignments and copying', () => {
  it('code tests and tool checks add to the automatic points (Arduino has no tests)', () => {
    const a = assignmentDataSchema.parse({ kinds: ['CODE'], maxPoints: 0, gradingMode: 'AUTO_REVIEW', code: { language: 'python', tests: [{ id: 't1', expected: '3', points: 2 }, { id: 't2', expected: '5', points: 3 }] } })
    expect([autoMax(a), totalMax(a)]).toEqual([5, 5])
    const ard = assignmentDataSchema.parse({ kinds: ['CODE'], maxPoints: 0, gradingMode: 'AUTO', code: { language: 'arduino', tests: [{ id: 't', expected: 'x', points: 9 }] }, toolCheck: { tool: 'ARDUINO', rules: [{ id: 'r', kind: 'HAS_SETUP_LOOP', points: 4 }] } })
    expect(autoMax(ard)).toBe(4)
    expect(autoMax({ ...ard, autoCheck: false })).toBe(0)
    expect(assignmentDataSchema.safeParse({ kinds: ['CODE'] }).success).toBe(false)
  })

  it('similarity ignores comments, spaces and case; short answers are not compared', () => {
    const a = 'for i in range(10):\n    # print numbers\n    print(i * 2)\ntotal = sum(range(10))\nprint(total)'
    const b = 'FOR i in range(10):\n print(i * 2)   # double\ntotal = sum(range(10))\nprint(total)'
    expect(similarity(a, b)).toBeGreaterThan(0.8)
    expect(similarity(a, 'name = input()\nprint("Hello " + name + ", welcome to TechNova robotics!")')).toBeLessThan(0.3)
    expect(similarity('print(1)', 'print(1)')).toBe(0)
  })
})
