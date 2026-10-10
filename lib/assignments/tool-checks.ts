/**
 * LMS L3 batch 2 — automatic checks of students' tool projects (pure: no network; tests in tests/tool-checks.test.ts).
 * The author picks rules from a fixed list per tool, each with points. Fetching / unzipping lives in tool-fetch.ts.
 *
 * Tools: SCRATCH (shared link or .sb3), MAKECODE (shared link), APPINVENTOR (.aia), SNAP (shared link or .xml),
 * GITHUB (public repo link), ARDUINO (code written in the editor or an .ino file — text checks only, no compiler).
 */

import { z } from 'zod'

export const TOOLS = ['SCRATCH', 'MAKECODE', 'APPINVENTOR', 'SNAP', 'GITHUB', 'ARDUINO'] as const
export type Tool = (typeof TOOLS)[number]

/** Rule kinds per tool. `param`: none | number | text. */
export const TOOL_RULES: Record<Tool, { kind: string; labelEn: string; labelAr: string; param: 'none' | 'number' | 'text' }[]> = {
  SCRATCH: [
    { kind: 'SPRITES_MIN', labelEn: 'At least N sprites', labelAr: 'على الأقل N شخصيات', param: 'number' },
    { kind: 'BLOCKS_MIN', labelEn: 'At least N blocks', labelAr: 'على الأقل N بلوك', param: 'number' },
    { kind: 'HAS_LOOP', labelEn: 'Uses a loop (repeat / forever)', labelAr: 'فيه حلقة تكرار', param: 'none' },
    { kind: 'HAS_CONDITION', labelEn: 'Uses a condition (if)', labelAr: 'فيه شرط (لو)', param: 'none' },
    { kind: 'HAS_VARIABLE', labelEn: 'Uses a variable', labelAr: 'فيه متغير', param: 'none' },
    { kind: 'HAS_SOUND', labelEn: 'Plays a sound', labelAr: 'فيه صوت', param: 'none' },
    { kind: 'HAS_BROADCAST', labelEn: 'Sends a message (broadcast)', labelAr: 'بيبعت رسالة (broadcast)', param: 'none' },
    { kind: 'HAS_KEY_EVENT', labelEn: 'Reacts to a key press', labelAr: 'بيستجيب لزرار الكيبورد', param: 'none' },
    { kind: 'USES_BLOCK', labelEn: 'Uses the block (opcode, e.g. motion_movesteps)', labelAr: 'بيستخدم بلوك معين', param: 'text' },
  ],
  MAKECODE: [
    { kind: 'HAS_LOOP', labelEn: 'Uses a loop (forever / for / while)', labelAr: 'فيه حلقة تكرار', param: 'none' },
    { kind: 'HAS_CONDITION', labelEn: 'Uses a condition (if)', labelAr: 'فيه شرط', param: 'none' },
    { kind: 'HAS_VARIABLE', labelEn: 'Uses a variable', labelAr: 'فيه متغير', param: 'none' },
    { kind: 'USES_BUTTON', labelEn: 'Uses a button (A / B)', labelAr: 'بيستخدم زرار A / B', param: 'none' },
    { kind: 'USES_LED', labelEn: 'Shows something on the LEDs', labelAr: 'بيعرض حاجة على الـ LED', param: 'none' },
    { kind: 'USES_SENSOR', labelEn: 'Uses a sensor (light, temperature, tilt…)', labelAr: 'بيستخدم حساس', param: 'none' },
    { kind: 'USES_TEXT', labelEn: 'The code contains (text)', labelAr: 'الكود فيه (نص)', param: 'text' },
  ],
  APPINVENTOR: [
    { kind: 'SCREENS_MIN', labelEn: 'At least N screens', labelAr: 'على الأقل N شاشات', param: 'number' },
    { kind: 'COMPONENT', labelEn: 'Has a component (e.g. Button, Image, Sound)', labelAr: 'فيه مكوّن معين', param: 'text' },
    { kind: 'BLOCKS_MIN', labelEn: 'At least N blocks', labelAr: 'على الأقل N بلوك', param: 'number' },
    { kind: 'HAS_CONDITION', labelEn: 'Uses a condition (if)', labelAr: 'فيه شرط', param: 'none' },
    { kind: 'HAS_LOOP', labelEn: 'Uses a loop', labelAr: 'فيه حلقة تكرار', param: 'none' },
    { kind: 'HAS_VARIABLE', labelEn: 'Uses a variable', labelAr: 'فيه متغير', param: 'none' },
  ],
  SNAP: [
    { kind: 'SPRITES_MIN', labelEn: 'At least N sprites', labelAr: 'على الأقل N شخصيات', param: 'number' },
    { kind: 'BLOCKS_MIN', labelEn: 'At least N blocks', labelAr: 'على الأقل N بلوك', param: 'number' },
    { kind: 'HAS_LOOP', labelEn: 'Uses a loop', labelAr: 'فيه حلقة تكرار', param: 'none' },
    { kind: 'HAS_CONDITION', labelEn: 'Uses a condition', labelAr: 'فيه شرط', param: 'none' },
    { kind: 'HAS_VARIABLE', labelEn: 'Uses a variable', labelAr: 'فيه متغير', param: 'none' },
  ],
  GITHUB: [
    { kind: 'HAS_README', labelEn: 'Has a README', labelAr: 'فيه README', param: 'none' },
    { kind: 'HAS_FILE', labelEn: 'Has the file (path, e.g. main.py)', labelAr: 'فيه ملف معين', param: 'text' },
    { kind: 'COMMITS_MIN', labelEn: 'At least N commits', labelAr: 'على الأقل N مرات حفظ (commits)', param: 'number' },
  ],
  ARDUINO: [
    { kind: 'HAS_SETUP_LOOP', labelEn: 'Has setup() and loop()', labelAr: 'فيه setup() و loop()', param: 'none' },
    { kind: 'BALANCED', labelEn: 'Brackets and quotes are balanced', labelAr: 'الأقواس متقفلة صح', param: 'none' },
    { kind: 'USES_FUNCTION', labelEn: 'Calls the function (e.g. digitalWrite)', labelAr: 'بيستخدم دالة معينة', param: 'text' },
    { kind: 'HAS_CONDITION', labelEn: 'Uses a condition (if)', labelAr: 'فيه شرط', param: 'none' },
    { kind: 'HAS_LOOP', labelEn: 'Uses a for / while loop', labelAr: 'فيه for / while', param: 'none' },
  ],
}

export const toolRuleSchema = z.object({ id: z.string().min(1).max(40), kind: z.string().min(1).max(30), value: z.union([z.string().max(100), z.number()]).nullish(), points: z.number().min(0).max(100).default(1) })
export const toolCheckSchema = z.object({ tool: z.enum(TOOLS), rules: z.array(toolRuleSchema).min(1).max(20) })
export type ToolRule = z.infer<typeof toolRuleSchema>
export type ToolCheck = z.infer<typeof toolCheckSchema>

export const toolMax = (c: ToolCheck | null | undefined) => (c ? c.rules.reduce((s, r) => s + r.points, 0) : 0)

/** What we found in a project (filled by the analysers below). */
export interface Facts {
  sprites?: number
  screens?: number
  blocks?: number
  /** block / opcode / component / function names found (lower case) */
  names: Set<string>
  /** whole code text (MakeCode / Arduino) lower case, for "contains" rules */
  text?: string
  files?: string[]
  commits?: number
  hasReadme?: boolean
  balanced?: boolean
}

// ───────────────────────── analysers ─────────────────────────

/** Scratch 3 project.json */
export function analyzeScratch(project: unknown): Facts {
  const p = project as { targets?: { isStage?: boolean; blocks?: Record<string, { opcode?: string }> }[] }
  const targets = p?.targets ?? []
  const names = new Set<string>()
  let blocks = 0
  for (const t of targets) for (const b of Object.values(t.blocks ?? {})) {
    if (!b || typeof b !== 'object' || !b.opcode) continue
    blocks++
    names.add(b.opcode.toLowerCase())
  }
  return { sprites: targets.filter((t) => !t.isStage).length, blocks, names }
}

/** MakeCode main.ts text */
export function analyzeMakecode(code: string): Facts {
  const text = code.toLowerCase()
  const names = new Set<string>()
  if (/basic\.forever|\bfor\s*\(|\bwhile\s*\(|loops\./.test(text)) names.add('loop')
  if (/\bif\s*\(/.test(text)) names.add('condition')
  if (/\b(let|const|var)\s+[a-z_]/.test(text)) names.add('variable')
  if (/input\.onbuttonpressed|input\.buttonispressed/.test(text)) names.add('button')
  if (/basic\.show(string|number|leds|icon|arrow)|led\./.test(text)) names.add('led')
  if (/input\.(temperature|lightlevel|acceleration|compassheading|rotation|soundlevel|magneticforce|ongesture)/.test(text)) names.add('sensor')
  return { names, text }
}

/** App Inventor: Screen*.scm (JSON after a "#|\n$JSON" header) + Screen*.bky (Blockly XML) */
export function analyzeAppInventor(files: Record<string, string>): Facts {
  const names = new Set<string>()
  let blocks = 0
  const scm = Object.entries(files).filter(([n]) => n.endsWith('.scm'))
  const walk = (c: { $Type?: string; $Components?: unknown[] }) => {
    if (c?.$Type) names.add(`component:${c.$Type.toLowerCase()}`)
    for (const k of c?.$Components ?? []) walk(k as never)
  }
  for (const [, txt] of scm) {
    const i = txt.indexOf('{')
    try { walk(JSON.parse(txt.slice(i, txt.lastIndexOf('}') + 1)).Properties) } catch { /* bad file */ }
  }
  for (const [n, xml] of Object.entries(files)) {
    if (!n.endsWith('.bky')) continue
    for (const m of xml.matchAll(/<block[^>]*type="([^"]+)"/g)) { blocks++; names.add(m[1].toLowerCase()) }
  }
  return { screens: scm.length, blocks, names }
}

/** Snap! project XML */
export function analyzeSnap(xml: string): Facts {
  const names = new Set<string>()
  let blocks = 0
  for (const m of xml.matchAll(/<block[^>]*\ss="([^"]+)"/g)) { blocks++; names.add(m[1].toLowerCase()) }
  const sprites = (xml.match(/<sprite\s/g) ?? []).length
  return { sprites, blocks, names }
}

/** Arduino / C++ text checks (no compiler). Comments and strings are removed before checking. */
export function analyzeArduino(code: string): Facts {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const stripped = noComments.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''")
  const text = stripped.toLowerCase()
  let balanced = true
  const stack: string[] = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  for (const ch of stripped) {
    if ('([{'.includes(ch)) stack.push(ch)
    else if (ch in pairs) { if (stack.pop() !== pairs[ch]) { balanced = false; break } }
  }
  if (stack.length) balanced = false
  if ((noComments.match(/"/g) ?? []).length % 2) balanced = false
  const names = new Set<string>()
  for (const m of text.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) names.add(m[1])
  if (/void\s+setup\s*\(\s*\)/.test(text) && /void\s+loop\s*\(\s*\)/.test(text)) names.add('setup+loop')
  if (/\bif\s*\(/.test(text)) names.add('condition')
  if (/\b(for|while)\s*\(/.test(text)) names.add('loop')
  return { names, text, balanced }
}

// ───────────────────────── rules ─────────────────────────

const has = (f: Facts, ...xs: string[]) => xs.some((x) => f.names.has(x))
const hasPrefix = (f: Facts, ...ps: string[]) => [...f.names].some((n) => ps.some((p) => n.startsWith(p)))

export function ruleOk(tool: Tool, r: ToolRule, f: Facts): boolean {
  const n = Number(r.value ?? 0)
  const t = String(r.value ?? '').trim().toLowerCase()
  switch (r.kind) {
    case 'SPRITES_MIN': return (f.sprites ?? 0) >= n
    case 'SCREENS_MIN': return (f.screens ?? 0) >= n
    case 'BLOCKS_MIN': return (f.blocks ?? 0) >= n
    case 'COMMITS_MIN': return (f.commits ?? 0) >= n
    case 'HAS_README': return !!f.hasReadme
    case 'HAS_FILE': return !!t && (f.files ?? []).some((p) => p.toLowerCase() === t || p.toLowerCase().endsWith(`/${t}`))
    case 'BALANCED': return !!f.balanced
    case 'HAS_SETUP_LOOP': return has(f, 'setup+loop')
    case 'USES_FUNCTION': return !!t && has(f, t)
    case 'USES_TEXT': return !!t && (f.text ?? '').includes(t)
    case 'USES_BLOCK': return !!t && has(f, t)
    case 'COMPONENT': return !!t && has(f, `component:${t}`)
    case 'USES_BUTTON': return has(f, 'button')
    case 'USES_LED': return has(f, 'led')
    case 'USES_SENSOR': return has(f, 'sensor')
    case 'HAS_LOOP':
      if (tool === 'SCRATCH') return has(f, 'control_repeat', 'control_forever', 'control_repeat_until')
      if (tool === 'APPINVENTOR') return hasPrefix(f, 'controls_for', 'controls_while')
      if (tool === 'SNAP') return has(f, 'doforever', 'dorepeat', 'dountil', 'dofor', 'doforeach')
      return has(f, 'loop')
    case 'HAS_CONDITION':
      if (tool === 'SCRATCH') return has(f, 'control_if', 'control_if_else', 'control_wait_until', 'control_repeat_until')
      if (tool === 'APPINVENTOR') return has(f, 'controls_if', 'controls_choose')
      if (tool === 'SNAP') return has(f, 'doif', 'doifelse', 'reportifelse')
      return has(f, 'condition')
    case 'HAS_VARIABLE':
      if (tool === 'SCRATCH') return hasPrefix(f, 'data_setvariableto', 'data_changevariableby')
      if (tool === 'APPINVENTOR') return hasPrefix(f, 'global_declaration', 'lexical_variable')
      if (tool === 'SNAP') return has(f, 'dosetvar', 'dochangevar', 'dodeclarevariables')
      return has(f, 'variable')
    case 'HAS_SOUND': return hasPrefix(f, 'sound_play', 'sound_playuntildone')
    case 'HAS_BROADCAST': return hasPrefix(f, 'event_broadcast')
    case 'HAS_KEY_EVENT': return has(f, 'event_whenkeypressed', 'sensing_keypressed')
    default: return false
  }
}

export interface RuleResult { id: string; kind: string; ok: boolean; points: number; max: number }

export function evaluateRules(c: ToolCheck, f: Facts): { score: number; max: number; detail: RuleResult[] } {
  const detail = c.rules.map((r) => { const ok = ruleOk(c.tool, r, f); return { id: r.id, kind: r.kind, ok, points: ok ? r.points : 0, max: r.points } })
  return { score: detail.reduce((s, d) => s + d.points, 0), max: toolMax(c), detail }
}

// ───────────────────────── links ─────────────────────────

/** Which tool / project a link points to (null = not one we can read). */
export function parseToolLink(url: string): { tool: Tool; id: string; owner?: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const h = u.hostname.replace(/^www\./, '')
    let m: RegExpMatchArray | null
    if (h === 'scratch.mit.edu' && (m = u.pathname.match(/\/projects\/(\d{3,12})/))) return { tool: 'SCRATCH', id: m[1] }
    if (/(^|\.)makecode\.(microbit\.org|com)$/.test(h) || h === 'arcade.makecode.com') {
      m = u.pathname.match(/\/(_[A-Za-z0-9]{8,16}|[0-9]{5}-[0-9]{5}-[0-9]{5}-[0-9]{5})/)
      if (m) return { tool: 'MAKECODE', id: m[1] }
    }
    if (h === 'snap.berkeley.edu') {
      const user = u.searchParams.get('username') ?? u.searchParams.get('user'), name = u.searchParams.get('projectname') ?? u.searchParams.get('project')
      if (user && name) return { tool: 'SNAP', id: name, owner: user }
    }
    if (h === 'github.com' && (m = u.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/))) return { tool: 'GITHUB', id: m[2], owner: m[1] }
    return null
  } catch {
    return null
  }
}
