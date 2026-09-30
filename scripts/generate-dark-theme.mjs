#!/usr/bin/env node
/**
 * Generates app/dark-theme.generated.css — dark mode for the WHOLE system.
 *
 * WHY generated instead of adding `dark:` classes everywhere: the UI has ~5,000
 * hard-coded Tailwind colours (bg-white, text-slate-900, bg-blue-50...) in ~220
 * files. Instead, when <html class="dark">:
 *  1. Neutral scales (slate/gray/zinc/neutral/stone) are re-mapped through their
 *     CSS variables: light shades become dark surfaces, dark shades become light
 *     text. Covers every variant (hover:, /50, sm:...) automatically.
 *     Surfaces that are meant to be dark (bg-slate-900 banners, dark buttons)
 *     are pinned to their original colour.
 *  2. White backgrounds (bg-white, bg-white/95, to-white...) become dark cards;
 *     text-white stays white (it sits on coloured buttons/banners).
 *  3. Coloured tints (bg-blue-50, border-emerald-200...) become dark tints, and
 *     dark coloured text (text-rose-700...) becomes a light shade, so badges and
 *     alerts stay readable. Solid colours (bg-blue-600 buttons) are unchanged.
 * Rules use :where(.dark) so they behave like Tailwind's own dark: variant
 * (a hover:/focus: class still wins over the base class).
 *
 * Only classes found in the source get a rule, so RE-RUN after adding UI with
 * colours not used before (it also runs automatically before every build):
 *   node scripts/generate-dark-theme.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const THEME = fs.readFileSync(path.join(ROOT, 'node_modules/tailwindcss/theme.css'), 'utf8')
const OUT = path.join(ROOT, 'app/dark-theme.generated.css')

const palette = {}
for (const m of THEME.matchAll(/--color-([a-z]+)-(\d+):\s*(oklch\([^)]+\))/g)) {
  ;(palette[m[1]] ??= {})[m[2]] = m[3]
}
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone']
const COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

// Dark-mode lightness for each neutral shade (keeps the family's hue/chroma).
const NEUTRAL_DARK_L = { 50: 17.5, 100: 22.5, 200: 29, 300: 37, 400: 56, 500: 67, 600: 75, 700: 83, 800: 89, 900: 94, 950: 97.5 }

const SURFACE = 'oklch(20.8% 0.042 265.755)' // cards (= original slate-900)
const PAGE = 'oklch(15.5% 0.035 265)' // page background

// Printable documents (ID cards, certificates, report cards, invoices, salary
// slips) keep their light colours in dark mode: they are exported to PDF/images
// from what is on screen. Mark any other such area with class="keep-light".
const EXEMPT = '.keep-light,[data-document-page],[data-pdf-page],#challan-container'
const NOT_EXEMPT = `:where(:not(:is(${EXEMPT}) *):not(:is(${EXEMPT})))`

const esc = (cls) => cls.replace(/([:/.\[\]=()%#,])/g, '\\$1')
const mix = (c, pct) => `color-mix(in oklab, ${c} ${pct}%, transparent)`

// Only classes that actually appear in the source get a rule (keeps the CSS small).
const used = new Set()
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) scan(f)
    else if (/\.(tsx|ts|jsx|js)$/.test(e.name)) {
      for (const t of fs.readFileSync(f, 'utf8').split(/[\s"'`{}]+/)) if (t) used.add(t)
    }
  }
}
for (const d of ['app', 'components', 'lib', 'hooks']) if (fs.existsSync(path.join(ROOT, d))) scan(path.join(ROOT, d))

const rules = []
/** Emit a rule for a class and its hover:/focus:/group-hover: forms, when used. */
function rule(cls, decl, { variants = true } = {}) {
  if (used.has(cls)) rules.push(`:where(.dark) .${esc(cls)}${NOT_EXEMPT}{${decl}}`)
  if (!variants) return
  if (used.has('hover:' + cls)) rules.push(`@media (hover:hover){:where(.dark) .${esc('hover:' + cls)}${NOT_EXEMPT}:hover{${decl}}}`)
  if (used.has('group-hover:' + cls)) rules.push(`@media (hover:hover){:where(.dark) .group:hover .${esc('group-hover:' + cls)}${NOT_EXEMPT}{${decl}}}`)
  if (used.has('focus:' + cls)) rules.push(`:where(.dark) .${esc('focus:' + cls)}${NOT_EXEMPT}:focus{${decl}}`)
}

// ── 1. neutral variables ──────────────────────────────────────────────────
const vars = []
const lightVars = []
for (const n of NEUTRALS) {
  for (const s of SHADES) {
    // Every neutral family uses slate's blue-grey tint in dark mode, so gray-,
    // zinc- and slate- screens look like one consistent navy theme.
    const orig = palette.slate[s]
    const [, , c, h] = orig.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/) ?? []
    // Dark surfaces (50-300) get a little more blue so pages read as navy, not grey.
    const chroma = +s <= 300 ? 0.03 : c
    vars.push(`--color-${n}-${s}:oklch(${NEUTRAL_DARK_L[s]}% ${chroma ?? 0} ${h ?? 0});`)
    if (palette[n]?.[s]) lightVars.push(`--color-${n}-${s}:${palette[n][s]};`)
  }
}

// Pinned dark surfaces (meant to be dark in both themes, usually with white text).
for (const n of NEUTRALS) {
  for (const s of ['700', '800', '900', '950']) {
    rule(`bg-${n}-${s}`, `background-color:${palette[n][s]}`)
    rule(`from-${n}-${s}`, `--tw-gradient-from:${palette[n][s]}`)
    rule(`via-${n}-${s}`, `--tw-gradient-via:${palette[n][s]};--tw-gradient-via-stops:var(--tw-gradient-position),var(--tw-gradient-from) var(--tw-gradient-from-position),var(--tw-gradient-via) var(--tw-gradient-via-position),var(--tw-gradient-to) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-via-stops)`)
    rule(`to-${n}-${s}`, `--tw-gradient-to:${palette[n][s]}`)
  }
}

// ── 2. white surfaces ─────────────────────────────────────────────────────
rule('bg-white', `background-color:${SURFACE}`)
for (const o of [50, 60, 70, 75, 80, 85, 90, 95]) rule(`bg-white/${o}`, `background-color:${mix(SURFACE, o)}`)
rule('from-white', `--tw-gradient-from:${SURFACE}`)
rule('via-white', `--tw-gradient-via:${SURFACE};--tw-gradient-via-stops:var(--tw-gradient-position),var(--tw-gradient-from) var(--tw-gradient-from-position),var(--tw-gradient-via) var(--tw-gradient-via-position),var(--tw-gradient-to) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-via-stops)`)
rule('to-white', `--tw-gradient-to:${SURFACE}`)
rule('data-active:bg-white', `background-color:${SURFACE}`, { variants: false })

// ── 3. coloured tints and text ────────────────────────────────────────────
const TINT_BG = { 50: 14, 100: 20, 200: 28 }
const TINT_BORDER = { 50: 18, 100: 24, 200: 34, 300: 45 }
const TEXT_LIGHTER = { 600: '400', 700: '300', 800: '200', 900: '200', 950: '100' }
const OPACITIES = [5, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90]
for (const c of COLORS) {
  const p = palette[c]
  for (const [s, pct] of Object.entries(TINT_BG)) {
    rule(`bg-${c}-${s}`, `background-color:${mix(p['500'], pct)}`)
    for (const o of OPACITIES) rule(`bg-${c}-${s}/${o}`, `background-color:${mix(p['500'], Math.max(4, Math.round((pct * o) / 100)))}`, { variants: false })
    rule(`from-${c}-${s}`, `--tw-gradient-from:${mix(p['500'], pct)}`)
    rule(`via-${c}-${s}`, `--tw-gradient-via:${mix(p['500'], pct)};--tw-gradient-via-stops:var(--tw-gradient-position),var(--tw-gradient-from) var(--tw-gradient-from-position),var(--tw-gradient-via) var(--tw-gradient-via-position),var(--tw-gradient-to) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-via-stops)`)
    rule(`to-${c}-${s}`, `--tw-gradient-to:${mix(p['500'], pct)}`)
    for (const o of OPACITIES) {
      const t = mix(p['500'], Math.max(4, Math.round((pct * o) / 100)))
      rule(`from-${c}-${s}/${o}`, `--tw-gradient-from:${t}`, { variants: false })
      rule(`via-${c}-${s}/${o}`, `--tw-gradient-via:${t};--tw-gradient-via-stops:var(--tw-gradient-position),var(--tw-gradient-from) var(--tw-gradient-from-position),var(--tw-gradient-via) var(--tw-gradient-via-position),var(--tw-gradient-to) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-via-stops)`, { variants: false })
      rule(`to-${c}-${s}/${o}`, `--tw-gradient-to:${t}`, { variants: false })
    }
  }
  for (const [s, pct] of Object.entries(TINT_BORDER)) {
    rule(`border-${c}-${s}`, `border-color:${mix(p['400'], pct)}`)
    rule(`ring-${c}-${s}`, `--tw-ring-color:${mix(p['400'], pct)}`)
    rule(`divide-${c}-${s}`, `border-color:${mix(p['400'], pct)}`, { variants: false })
  }
  for (const [s, to] of Object.entries(TEXT_LIGHTER)) {
    rule(`text-${c}-${s}`, `color:${p[to]}`)
  }
}

// Screen only: printing (window.print) always uses the light colours.
const css = `/* GENERATED by scripts/generate-dark-theme.mjs - do not edit by hand. */
@media screen{
.dark{color-scheme:dark;${vars.join('')}}
.dark body{background-color:${PAGE}}
.dark :is(${EXEMPT}){color-scheme:light;${lightVars.join('')}--background:0 0% 100%;--foreground:222.2 84% 4.9%;--card:0 0% 100%;--card-foreground:222.2 84% 4.9%;--muted:210 40% 96.1%;--muted-foreground:215.4 16.3% 46.9%;--border:214.3 31.8% 91.4%}
}
@layer utilities{@media screen{
${rules.join('\n')}
}}
`
fs.writeFileSync(OUT, css)
console.log(`[dark-theme] wrote ${path.relative(ROOT, OUT)} (${rules.length} rules, ${(css.length / 1024).toFixed(0)} KB)`)
