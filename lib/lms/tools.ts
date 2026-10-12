/**
 * LMS L5 (owner 2026-10-11): external tools inside a lesson. Pure (tested in tests/lms-tools.test.ts).
 * - INLINE tools open inside the lesson page (sandboxed frame); NEW_TAB tools refuse to be shown inside another site,
 *   so the student opens them in a new tab and hands in the project link in the homework.
 * - Admins can add more sites (AppSetting `lms.tools`); everything else is refused.
 */

export type ToolMode = 'INLINE' | 'NEW_TAB'
export interface ToolDef { id: string; nameEn: string; nameAr: string; category: string; hosts: string[]; mode: ToolMode; example: string }
export interface ExtraSite { host: string; nameEn: string; nameAr: string; mode: ToolMode }

export const TOOL_CATEGORIES: Record<string, { en: string; ar: string }> = {
  BLOCKS: { en: 'Block coding', ar: 'برمجة بالبلوكات' },
  TEXT: { en: 'Text coding', ar: 'برمجة بالكتابة' },
  ELECTRONICS: { en: 'Electronics & robots', ar: 'إلكترونيات وروبوتات' },
  AI: { en: 'Artificial intelligence', ar: 'ذكاء اصطناعي' },
  MATH: { en: 'Maths & science', ar: 'رياضيات وعلوم' },
  GAMES: { en: 'Games & review', ar: 'ألعاب ومراجعة' },
  OTHER: { en: 'Other sites', ar: 'مواقع تانية' },
}

export const TOOL_CATALOG: ToolDef[] = [
  { id: 'scratch', nameEn: 'Scratch', nameAr: 'سكراتش', category: 'BLOCKS', hosts: ['scratch.mit.edu'], mode: 'INLINE', example: 'https://scratch.mit.edu/projects/10128407' },
  { id: 'makecode-microbit', nameEn: 'MakeCode micro:bit', nameAr: 'ميك كود micro:bit', category: 'BLOCKS', hosts: ['makecode.microbit.org'], mode: 'INLINE', example: 'https://makecode.microbit.org/_xxxxxxxx' },
  { id: 'makecode-arcade', nameEn: 'MakeCode Arcade', nameAr: 'ميك كود Arcade', category: 'BLOCKS', hosts: ['arcade.makecode.com'], mode: 'INLINE', example: 'https://arcade.makecode.com/_xxxxxxxx' },
  { id: 'blockly-games', nameEn: 'Blockly Games', nameAr: 'ألعاب Blockly', category: 'BLOCKS', hosts: ['blockly.games'], mode: 'INLINE', example: 'https://blockly.games/maze?lang=en' },
  { id: 'snap', nameEn: 'Snap!', nameAr: 'Snap!', category: 'BLOCKS', hosts: ['snap.berkeley.edu'], mode: 'INLINE', example: 'https://snap.berkeley.edu/snap/snap.html' },
  { id: 'code-org', nameEn: 'Code.org', nameAr: 'Code.org', category: 'BLOCKS', hosts: ['code.org', 'studio.code.org'], mode: 'NEW_TAB', example: 'https://studio.code.org/s/express-2024' },
  { id: 'app-inventor', nameEn: 'App Inventor', nameAr: 'App Inventor', category: 'BLOCKS', hosts: ['appinventor.mit.edu', 'ai2.appinventor.mit.edu'], mode: 'NEW_TAB', example: 'https://ai2.appinventor.mit.edu' },
  { id: 'trinket', nameEn: 'Trinket (Python)', nameAr: 'Trinket (بايثون)', category: 'TEXT', hosts: ['trinket.io'], mode: 'INLINE', example: 'https://trinket.io/embed/python3/xxxxxxxx' },
  { id: 'python-tutor', nameEn: 'Python Tutor', nameAr: 'Python Tutor', category: 'TEXT', hosts: ['pythontutor.com'], mode: 'INLINE', example: 'https://pythontutor.com/iframe-embed.html#code=print(1)' },
  { id: 'p5js', nameEn: 'p5.js', nameAr: 'p5.js', category: 'TEXT', hosts: ['editor.p5js.org'], mode: 'INLINE', example: 'https://editor.p5js.org/user/full/xxxxxxxx' },
  { id: 'codepen', nameEn: 'CodePen', nameAr: 'CodePen', category: 'TEXT', hosts: ['codepen.io'], mode: 'INLINE', example: 'https://codepen.io/user/pen/xxxxxx' },
  { id: 'replit', nameEn: 'Replit', nameAr: 'Replit', category: 'TEXT', hosts: ['replit.com'], mode: 'NEW_TAB', example: 'https://replit.com/@user/project' },
  { id: 'wokwi', nameEn: 'Wokwi (Arduino / ESP32)', nameAr: 'Wokwi (أردوينو / ESP32)', category: 'ELECTRONICS', hosts: ['wokwi.com'], mode: 'INLINE', example: 'https://wokwi.com/projects/322062421191557714' },
  { id: 'tinkercad', nameEn: 'Tinkercad', nameAr: 'Tinkercad', category: 'ELECTRONICS', hosts: ['tinkercad.com'], mode: 'INLINE', example: 'https://www.tinkercad.com/things/xxxxxxxx' },
  { id: 'falstad', nameEn: 'Falstad circuits', nameAr: 'محاكي دوائر Falstad', category: 'ELECTRONICS', hosts: ['falstad.com'], mode: 'INLINE', example: 'https://www.falstad.com/circuit/circuitjs.html' },
  { id: 'open-roberta', nameEn: 'Open Roberta Lab', nameAr: 'Open Roberta Lab', category: 'ELECTRONICS', hosts: ['lab.open-roberta.org'], mode: 'NEW_TAB', example: 'https://lab.open-roberta.org' },
  { id: 'vexcode-vr', nameEn: 'VEXcode VR', nameAr: 'VEXcode VR', category: 'ELECTRONICS', hosts: ['vr.vex.com'], mode: 'NEW_TAB', example: 'https://vr.vex.com' },
  { id: 'teachable-machine', nameEn: 'Teachable Machine', nameAr: 'Teachable Machine', category: 'AI', hosts: ['teachablemachine.withgoogle.com'], mode: 'NEW_TAB', example: 'https://teachablemachine.withgoogle.com/train' },
  { id: 'ml4kids', nameEn: 'Machine Learning for Kids', nameAr: 'Machine Learning for Kids', category: 'AI', hosts: ['machinelearningforkids.co.uk'], mode: 'NEW_TAB', example: 'https://machinelearningforkids.co.uk' },
  { id: 'geogebra', nameEn: 'GeoGebra', nameAr: 'جيوجبرا', category: 'MATH', hosts: ['geogebra.org'], mode: 'INLINE', example: 'https://www.geogebra.org/m/xxxxxxxx' },
  { id: 'phet', nameEn: 'PhET simulations', nameAr: 'تجارب PhET', category: 'MATH', hosts: ['phet.colorado.edu'], mode: 'INLINE', example: 'https://phet.colorado.edu/sims/html/circuit-construction-kit-dc/latest/circuit-construction-kit-dc_all.html' },
  { id: 'desmos', nameEn: 'Desmos', nameAr: 'Desmos', category: 'MATH', hosts: ['desmos.com'], mode: 'INLINE', example: 'https://www.desmos.com/calculator/xxxxxxxx' },
  { id: 'wordwall', nameEn: 'Wordwall', nameAr: 'Wordwall', category: 'GAMES', hosts: ['wordwall.net'], mode: 'INLINE', example: 'https://wordwall.net/resource/xxxxxxx' },
  { id: 'learningapps', nameEn: 'LearningApps', nameAr: 'LearningApps', category: 'GAMES', hosts: ['learningapps.org'], mode: 'INLINE', example: 'https://learningapps.org/watch?v=xxxxxxx' },
  { id: 'genially', nameEn: 'Genially', nameAr: 'Genially', category: 'GAMES', hosts: ['genially.com', 'view.genially.com', 'view.genial.ly', 'genial.ly'], mode: 'INLINE', example: 'https://view.genially.com/xxxxxxxx' },
  { id: 'kahoot', nameEn: 'Kahoot', nameAr: 'Kahoot', category: 'GAMES', hosts: ['kahoot.it', 'kahoot.com', 'create.kahoot.it'], mode: 'NEW_TAB', example: 'https://kahoot.it' },
]

/** Host of a link (lower case, no www.), or null when it is not an https link. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const matches = (host: string, allowed: string) => host === allowed || host.endsWith(`.${allowed}`)

/** Cleans an admin-typed site ("https://www.site.com/x" → "site.com"); null when it is not a usable host. */
export function cleanHost(input: string): string | null {
  const raw = input.trim().toLowerCase()
  const h = raw.includes('://') ? hostOf(raw) : raw.replace(/^www\./, '').split('/')[0]
  if (!h || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || h.length > 100) return null
  return h
}

export interface ToolMatch { id: string; nameEn: string; nameAr: string; mode: ToolMode; category: string }

/** Which catalog tool / admin site a link belongs to (null = not allowed). */
export function toolForUrl(url: string, extra: ExtraSite[] = []): ToolMatch | null {
  const h = hostOf(url)
  if (!h) return null
  const t = TOOL_CATALOG.find((x) => x.hosts.some((a) => matches(h, a)))
  if (t) return { id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, mode: t.mode, category: t.category }
  const e = extra.find((x) => matches(h, x.host))
  return e ? { id: `site:${e.host}`, nameEn: e.nameEn, nameAr: e.nameAr || e.nameEn, mode: e.mode, category: 'OTHER' } : null
}

/** Every host that may be embedded (catalog INLINE tools + admin INLINE sites). */
export const inlineHosts = (extra: ExtraSite[] = []) => [
  ...TOOL_CATALOG.filter((t) => t.mode === 'INLINE').flatMap((t) => t.hosts),
  ...extra.filter((e) => e.mode === 'INLINE').map((e) => e.host),
]

/** The link to put inside the frame (project pages → the site's own player / embed link). */
export function toolEmbedUrl(url: string): string {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname
    let m: RegExpMatchArray | null
    if (h === 'scratch.mit.edu' && (m = path.match(/^\/projects\/(\d+)/)) && !path.includes('/embed')) return `https://scratch.mit.edu/projects/${m[1]}/embed`
    if (h === 'tinkercad.com' && (m = path.match(/^\/things\/([\w-]+)/))) return `https://www.tinkercad.com/embed/${m[1]}?editbtn=1`
    if (h === 'wokwi.com' && path.startsWith('/projects/') && !u.searchParams.has('embed')) { u.searchParams.set('embed', '1'); return u.toString() }
    if ((h === 'makecode.microbit.org' || h === 'arcade.makecode.com') && (m = path.match(/^\/(_[\w]+)/))) return `https://${h}/---run?id=${m[1]}`
    if (h === 'geogebra.org' && (m = path.match(/^\/m\/([\w]+)/))) return `https://www.geogebra.org/material/iframe/id/${m[1]}`
    if (h === 'trinket.io' && !path.startsWith('/embed/') && (m = path.match(/^\/(python3?|html|blocks|glowscript)\/([\w]+)/))) return `https://trinket.io/embed/${m[1]}/${m[2]}`
    if (h === 'codepen.io' && (m = path.match(/^\/([\w-]+)\/pen\/([\w]+)/))) return `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`
    if (h === 'editor.p5js.org' && (m = path.match(/^\/([\w-]+)\/sketches\/([\w-]+)/))) return `https://editor.p5js.org/${m[1]}/full/${m[2]}`
    return url
  } catch {
    return url
  }
}
