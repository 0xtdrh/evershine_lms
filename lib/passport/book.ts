/**
 * The new "real passport" look (owner 28/11/2026, map S49) — pure rules, no database. Tests: tests/passport-book.test.ts.
 * - Cover title is a setting (default «جواز سفر TechNova»).
 * - Seal: DRAWN (TechNova seal drawn here, downloadable as SVG for a rubber stamp) | IMAGE (the owner's own stamp photo) |
 *   NONE (signature only). The signature image is optional and shows with any seal choice.
 * - The data page fields: each one has two switches — shown in the passport (screen + paper) and shown in the parent's
 *   share link. The share link never shows the age / school unless the owner switches it on.
 * - Season templates for event stamps: an editable list (dates as MM-DD; Ramadan / Eid move every year → `moves`).
 * - Renewal: every `stampsPerBook` stamps the child gets a new passport (edition 2, 3 …); the old pages stay as "old passports".
 */

export const FIELD_KEYS = ['photo', 'age', 'place', 'school', 'joined', 'firstSession', 'reg', 'hours', 'projects', 'certificates', 'tracks'] as const
export type FieldKey = (typeof FIELD_KEYS)[number]
export type FieldShow = { passport: boolean; share: boolean }

export const FIELD_LABELS: Record<FieldKey, { en: string; ar: string }> = {
  photo: { en: 'Photo', ar: 'الصورة' },
  age: { en: 'Age', ar: 'السن' },
  place: { en: 'Place', ar: 'المكان' },
  school: { en: 'School', ar: 'المدرسة' },
  joined: { en: 'Date joined', ar: 'تاريخ الانضمام' },
  firstSession: { en: 'First session', ar: 'أول حصة' },
  reg: { en: 'Registration no.', ar: 'رقم القيد' },
  hours: { en: 'Learning hours', ar: 'ساعات التعلّم' },
  projects: { en: 'Projects', ar: 'المشاريع' },
  certificates: { en: 'Certificates', ar: 'الشهادات' },
  tracks: { en: 'Tracks graduated', ar: 'المسارات اللي اتخرّج منها' },
}

/** Defaults: everything in the passport; the share link (seen by strangers) leaves out age, school, first session, reg. */
export const DEFAULT_FIELDS: Record<FieldKey, FieldShow> = {
  photo: { passport: true, share: true },
  age: { passport: true, share: false },
  place: { passport: true, share: true },
  school: { passport: true, share: false },
  joined: { passport: true, share: true },
  firstSession: { passport: true, share: false },
  reg: { passport: true, share: false },
  hours: { passport: true, share: true },
  projects: { passport: true, share: true },
  certificates: { passport: true, share: true },
  tracks: { passport: true, share: true },
}

/** Fills missing / broken entries from the defaults (old saved settings have none). */
export function normalizeFields(v: unknown): Record<FieldKey, FieldShow> {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, Partial<FieldShow>>
  const out = {} as Record<FieldKey, FieldShow>
  for (const k of FIELD_KEYS) {
    const d = DEFAULT_FIELDS[k]
    const x = src[k] ?? {}
    out[k] = { passport: typeof x.passport === 'boolean' ? x.passport : d.passport, share: typeof x.share === 'boolean' ? x.share : d.share }
  }
  return out
}

export interface Season { en: string; ar: string; icon: string; color: string; from: string; to: string; moves?: boolean }

/** Ready season templates (owner 28/11): edit, remove or add your own in Passport → Settings. */
export const DEFAULT_SEASONS: Season[] = [
  { en: 'Christmas', ar: 'عيد الميلاد المجيد', icon: '🎄', color: '#15803d', from: '01-01', to: '01-10' },
  { en: 'Mid-year break', ar: 'أجازة نص السنة', icon: '❄️', color: '#0284c7', from: '01-20', to: '02-10' },
  { en: "Mother's Day", ar: 'عيد الأم', icon: '💐', color: '#e11d48', from: '03-21', to: '03-21' },
  { en: 'Ramadan', ar: 'رمضان', icon: '🌙', color: '#7c3aed', from: '02-18', to: '03-19', moves: true },
  { en: 'Eid al-Fitr', ar: 'عيد الفطر', icon: '🎉', color: '#db2777', from: '03-20', to: '03-23', moves: true },
  { en: 'Sham El-Nessim', ar: 'شم النسيم', icon: '🌸', color: '#16a34a', from: '04-13', to: '04-13', moves: true },
  { en: 'Big competition', ar: 'المسابقة الكبيرة', icon: '🏆', color: '#ca8a04', from: '05-01', to: '05-31' },
  { en: 'Eid al-Adha', ar: 'عيد الأضحى', icon: '🐑', color: '#9333ea', from: '05-26', to: '05-29', moves: true },
  { en: 'Summer camp', ar: 'كامب الصيف', icon: '☀️', color: '#ea580c', from: '07-01', to: '08-31' },
  { en: 'Back to school', ar: 'أول الدراسة', icon: '🎒', color: '#0891b2', from: '09-15', to: '10-15' },
  { en: "Children's Day", ar: 'يوم الطفل', icon: '🧒', color: '#f59e0b', from: '11-20', to: '11-20' },
  { en: 'Hour of Code', ar: 'أسبوع البرمجة', icon: '💻', color: '#2563eb', from: '12-07', to: '12-13' },
]

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const isMonthDay = (s: string) => MD.test(s)

/** A season template → the two dates of an event stamp in a given year (a season that crosses the new year ends next year). */
export function seasonDates(s: Pick<Season, 'from' | 'to'>, year: number): { from: string; to: string } {
  return { from: `${year}-${s.from}`, to: `${s.to < s.from ? year + 1 : year}-${s.to}` }
}

/** Renewal: which passport (edition) the stamps fill, and how many stamps are on the current one. */
export function passportEdition(stamps: number, perBook: number): { edition: number; onThisBook: number; perBook: number; justRenewed: boolean } {
  const per = Math.max(6, Math.min(Math.round(perBook) || 24, 200))
  const n = Math.max(0, Math.floor(stamps))
  const edition = n === 0 ? 1 : Math.floor((n - 1) / per) + 1
  const onThisBook = n - (edition - 1) * per
  return { edition, onThisBook, perBook: per, justRenewed: edition > 1 && onThisBook <= 1 }
}

/** The number shown for an edition: TN-PASS-2026-0012, then TN-PASS-2026-0012-2 … */
export const editionNumber = (number: string, edition: number) => (edition > 1 ? `${number}-${edition}` : number)

const AR_LATIN: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'o', 'ي': 'y', 'ى': 'a', 'ة': 'a', 'ء': '', 'ئ': 'e', 'ؤ': 'o',
}
/** Arabic letters → rough Latin (only for the machine lines' look). */
export const toLatin = (s: string) => [...s].map((ch) => AR_LATIN[ch] ?? ch).join('')

/** Machine-readable lines at the bottom of the data page (just for the look; Latin letters only, 30 characters). */
export function mrzLines(nameLatin: string, number: string, joined: Date | string | null): [string, string] {
  const clean = (s: string) => toLatin(s).toUpperCase().normalize('NFKD').replace(/[^A-Z0-9 ]/g, '').trim()
  const parts = clean(nameLatin).split(/\s+/).filter(Boolean)
  const first = parts[0] ?? ''
  const rest = parts.slice(1).join('<')
  const pad = (s: string) => (s + '<'.repeat(30)).slice(0, 30)
  const d = joined ? new Date(joined) : null
  const ymd = d && !isNaN(d.getTime()) ? `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}` : '000000'
  return [pad(`P<TNV${rest ? `${rest}<<` : ''}${first}`), pad(`${number.replace(/[^A-Z0-9]/gi, '').toUpperCase()}<${ymd}<TECHNOVA`)]
}

/** The «Place» field: a TechNova branch by name, a partner school as «name · partner», online as «Online». */
export function placeLabel(p: { name: string; kind: string | null; online: boolean } | null, ar: boolean): string {
  if (!p) return ''
  if (p.online || p.kind === 'ONLINE') return ar ? 'أونلاين' : 'Online'
  if (p.kind === 'PARTNER') return `${p.name} · ${ar ? 'شريك' : 'partner'}`
  return p.name
}

/** Learning hours from attended sessions (each group's own length, else the default). */
export function learningHours(sessions: { minutes: number | null }[], defaultMinutes: number): number {
  const m = sessions.reduce((a, s) => a + (s.minutes && s.minutes > 0 ? s.minutes : defaultMinutes), 0)
  return Math.round(m / 6) / 10
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
const arabic = (s: string) => /[\u0600-\u06FF]/.test(s)
/** Long seal text is squeezed onto its arc (never cut off). */
const fit = (s: string, size: number, room: number) => {
  const width = [...s].length * size * (arabic(s) ? 0.5 : 0.72)
  return width > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : ''
}

/**
 * The drawn TechNova seal (owner 28/11): two rings, text around (top + bottom), «TN» and a small star in the middle.
 * `mono` = black only (for the stamp maker). The same string is used on screen, on paper and in the SVG download.
 */
export function sealSvg(opts: { top: string; bottom: string; mono?: boolean; color?: string } = { top: 'TECHNOVA', bottom: 'HURGHADA' }): string {
  const c = opts.mono ? '#000000' : (/^#[0-9a-fA-F]{6}$/.test(opts.color ?? '') ? opts.color! : '#0B3A5B')
  const top = esc((opts.top || 'TECHNOVA').slice(0, 34))
  const bottom = esc((opts.bottom || '').slice(0, 34))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
<defs><path id="tnTop" d="M 32,100 A 68,68 0 0 1 168,100"/><path id="tnBottom" d="M 30,100 A 70,70 0 0 0 170,100"/></defs>
<circle cx="100" cy="100" r="94" fill="none" stroke="${c}" stroke-width="5"/>
<circle cx="100" cy="100" r="86" fill="none" stroke="${c}" stroke-width="1.5"/>
<circle cx="100" cy="100" r="50" fill="none" stroke="${c}" stroke-width="2"/>
<text font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="${arabic(opts.top) ? 0 : 2}" fill="${c}"><textPath href="#tnTop" startOffset="50%" text-anchor="middle"${fit(opts.top || 'TECHNOVA', 17, 196)}>${top}</textPath></text>
<text font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="${arabic(opts.bottom) ? 0 : 2}" fill="${c}" dominant-baseline="hanging"><textPath href="#tnBottom" startOffset="50%" text-anchor="middle"${fit(opts.bottom || '', 15, 200)}>${bottom}</textPath></text>
<text x="22" y="106" font-size="14" fill="${c}" text-anchor="middle">★</text><text x="178" y="106" font-size="14" fill="${c}" text-anchor="middle">★</text>
<text x="100" y="104" font-family="Arial Black, Arial, sans-serif" font-size="40" font-weight="900" fill="${c}" text-anchor="middle" dominant-baseline="middle">TN</text>
<text x="100" y="134" font-family="Arial, sans-serif" font-size="9" letter-spacing="2" fill="${c}" text-anchor="middle">STEM · ROBOTICS</text></svg>`
}
