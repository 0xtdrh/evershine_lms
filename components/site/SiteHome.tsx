'use client'

/**
 * x01 — TechNova public home page (design direction B: the diagonal N of the logo + circuit lines in dark sections).
 * Content: lib/site/content.ts (two languages, every element can be hidden; examples only in the preview).
 */

import './site.css'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { I18nProvider, useI18n } from '@/lib/i18n/client'
import { visible, type Bi, type Card, type MediaCard, type SiteContent } from '@/lib/site/content'
import { RequestForm, type FormOpen } from './RequestForm'
import { SignupWizard } from './SignupWizard'
import { CookieNotice } from './CookieNotice'
import { CATEGORIES, youtubeEmbed } from '@/lib/site/items'
import type { PublicItem } from '@/lib/site/items-store'
import type { CertificateCheck } from '@/lib/site/verify'
import type { PublicCampaign } from '@/lib/site/campaigns-store'
import type { PublicCourse } from '@/lib/site/courses-store'
import { AGE_BANDS, ageText, fitsBand, fromPrice } from '@/lib/site/courses'
import type { RequestKind } from '@/lib/site/request-rules'
import { PAGE_PATH, PAGE_SECTIONS, PAGE_TITLE, SITE_HOME, pageHref, pageOf, slugify, type SitePage } from '@/lib/site/pages'
import { track, useSiteTracker } from './tracker'
import { shownStats, type SiteStats } from '@/lib/site/stats-shared'

const ICONS: Record<string, string> = {
  cap: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  hotel: 'M3 21V7l9-4 9 4v14M9 21v-5h6v5M8 10h2M14 10h2',
  chip: 'M6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
  wave: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  check: 'M20 6L9 17l-5-5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  grow: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  building: 'M4 21V3h10v18M14 9h6v12M8 7h2M8 11h2M8 15h2',
  play: 'M8 5v14l11-7z',
  arrow: 'M15 18l-6-6 6-6',
  robot: 'M12 3v3M8 7h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM9.5 12h.01M14.5 12h.01M9 16h6M3 12v2M21 12v2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  facebook: 'M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H7v3.5h2V21h3.5v-8.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  tiktok: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.5 2.5 4.5 5 4.5',
  youtube: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z',
  linkedin: 'M4 9h4v11H4zM6 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM11 9h3.6v1.6c.6-1 1.8-1.9 3.4-1.9 2.6 0 3 1.8 3 4V20h-4v-6c0-1.2-.2-2.2-1.5-2.2S14 12.9 14 14v6h-3z',
}

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const fill = name === 'play'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.check} />
    </svg>
  )
}

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.tns-reveal'))
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('tns-in')); return }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('tns-in'); io.unobserve(en.target) }
    }, { threshold: 0.12 })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

function CountUp({ value, plus }: { value: number; plus?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [n, setN] = useState(value)
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setN(0)
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1200)
        setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [value])
  return <span ref={ref} className="tns-num">{n.toLocaleString('en-US')}{plus ? '+' : ''}</span>
}

function useMotionOk() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setOk(!m.matches)
    on()
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [])
  return ok
}

function Circuit() {
  const motion = useMotionOk()
  return (
    <svg className="tns-circuit" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="#1a4a6e" strokeWidth="2">
        <path d="M0 120 H220 L260 160 H460" /><path d="M0 420 H140 L190 370 H360" />
        <path d="M1200 90 H960 L920 130 H780" /><path d="M1200 500 H1060 L1020 460 H880" /><path d="M600 600 V520 L640 480 H820" />
      </g>
      <g fill="none" stroke="#3cc4da" strokeWidth="2">
        <path className="lit" d="M460 160 H560 L600 200 V300" /><path className="lit" d="M780 130 H700 L660 170" />
      </g>
      <g fill="#3cc4da"><circle cx="460" cy="160" r="5" /><circle cx="600" cy="300" r="6" /><circle cx="780" cy="130" r="5" /><circle cx="660" cy="170" r="6" /></g>
      {motion ? (
        <g fill="#a5f0fb">
          <circle r="4"><animateMotion dur="3.2s" repeatCount="indefinite" path="M0 120 H220 L260 160 H460 H560 L600 200 V300" /></circle>
          <circle r="3.5"><animateMotion dur="2.6s" begin="1s" repeatCount="indefinite" path="M1200 90 H960 L920 130 H780 H700 L660 170" /></circle>
          <circle r="3"><animateMotion dur="4s" begin=".5s" repeatCount="indefinite" path="M600 600 V520 L640 480 H820" /></circle>
        </g>
      ) : null}
    </svg>
  )
}

function Sample({ on }: { on?: boolean }) {
  const { locale } = useI18n()
  return on ? <span className="tns-sample">{locale === 'ar' ? 'مثال' : 'Example'}</span> : null
}

export interface SiteDetail { solution?: Card; item?: PublicItem; certificate?: { number: string; result: CertificateCheck | null }; campaign?: PublicCampaign }

function View({ C, items, stats, preview, page, detail, banner, courses = [] }: { C: SiteContent; items: PublicItem[]; stats: SiteStats | null; preview: boolean; page: SitePage; detail?: SiteDetail; banner?: PublicCampaign | null; courses?: PublicCourse[] }) {
  const { locale, setLocale } = useI18n()
  const t = (x: Bi) => (locale === 'ar' ? x.ar : x.en)
  const arr = locale === 'ar' ? '←' : '→'
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [menu, setMenu] = useState(false)
  const [cert, setCert] = useState('')
  const [form, setFormRaw] = useState<FormOpen | null>(null)
  const setForm = (f: FormOpen | null) => { if (f) track('FORM_OPEN', `${f.kind}:${f.page}`); setFormRaw(f) }
  const router = useRouter()
  useEffect(() => setMounted(true), [])
  useReveal()
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState('')
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    const html = document.documentElement
    const prev = html.style.scrollBehavior
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) html.style.scrollBehavior = 'smooth'
    const ids = C.nav.map((n) => n.href.replace('#', '')).filter(Boolean)
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting)
      setActive(ids.find((id) => seen.get(id)) ?? '')
    }, { rootMargin: '-45% 0px -50% 0px' })
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => { window.removeEventListener('scroll', onScroll); io.disconnect(); html.style.scrollBehavior = prev }
  }, [C.nav])
  useSiteTracker(locale)

  const nav = visible(C.nav, preview).map((n) => ({ ...n, href: pageHref(n.href) }))
  const home = page === 'home'
  const on = (k: string) => PAGE_SECTIONS[page].includes(k)
  const [cat, setCat] = useState('ALL')
  const [modeFilter, setModeFilter] = useState<'ALL' | 'ONLINE' | 'RECORDED'>('ALL')
  const [ageFilter, setAgeFilter] = useState('')
  const [search, setSearch] = useState('')
  const listPage = page === 'products' || page === 'achievements' || page === 'media'
  const head = (title: Bi, key: string) => (
    <div className="tns-head-row">
      <h2 className="tns-h2">{t(title)}</h2>
      {home && PAGE_PATH[key] ? <a className="tns-more" href={PAGE_PATH[key]}>{locale === 'ar' ? 'اعرف أكتر' : 'Learn more'} {arr}</a> : null}
    </div>
  )
  const numbers = shownStats(C.stats, stats)
  const real = (k: PublicItem['kind']) => items.filter((i) => i.kind === k)
  const realAchievements = real('ACHIEVEMENT')
  const realProducts = real('PRODUCT')
  const realMedia = real('MEDIA')
  const achievements = realAchievements.length ? [] : visible(C.achievements.items, preview)
  const products = realProducts.length ? [] : visible(C.products.items, preview)
  const media = realMedia.length ? [] : visible(C.media.items, preview)
  const events = visible(C.events.items, preview)
  const waDigits = C.contact.whatsapp.replace(/\D/g, '').replace(/^00/, '')
  const wa = waDigits ? `https://wa.me/${waDigits.startsWith('0') ? `2${waDigits}` : waDigits}` : ''
  const dark = mounted && resolvedTheme === 'dark'

  const cards = (items: Card[], d = false, linkOf?: (c: Card) => string) => items.filter((c) => c.show !== false).map((c, i) => (
    <div key={i} className={`tns-card tns-reveal${d ? ' d' : ''}`} style={{ ['--d' as string]: `${Math.min(i, 8) * 70}ms` }}>
      {c.icon ? <span className="tns-ico"><Icon name={c.icon} /></span> : null}
      <h3>{t(c.title)}</h3>
      <p>{t(c.text)}</p>
      {linkOf ? <a className="more flip" href={linkOf(c)}>{locale === 'ar' ? 'التفاصيل' : 'Details'} {arr}</a> : c.href ? <a className="more flip" href={pageHref(c.href)}>{locale === 'ar' ? 'ادخل القسم' : 'Explore'} {arr}</a> : null}
    </div>
  ))
  const thumbOf = (it: PublicItem) => {
    if (it.imageUrl) return it.imageUrl
    const yt = youtubeEmbed(it.videoUrl)
    return yt ? `https://img.youtube.com/vi/${yt.split('/').pop()}/hqdefault.jpg` : null
  }
  const itemCards = (all: PublicItem[], kind: PublicItem['kind']) => (home ? all.slice(0, kind === 'MEDIA' ? 6 : 8) : all.filter((x) => cat === 'ALL' || x.category === cat)).map((it, i) => {
    const img = thumbOf(it)
    const href = it.videoUrl || it.linkUrl
    const cat = (CATEGORIES[kind] as Record<string, Bi>)[it.category]
    return (
      <div key={it.id} className="tns-card tns-reveal tns-item" style={{ padding: 14, ['--d' as string]: `${Math.min(i, 8) * 70}ms` }}>
        <div className="tns-thumb">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" loading="lazy" />
          ) : <Icon name={kind === 'PRODUCT' ? 'layers' : kind === 'ACHIEVEMENT' ? 'trophy' : 'screen'} size={34} />}
          {it.videoUrl ? <span className="play"><Icon name="play" size={22} /></span> : null}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {cat ? <span className="tns-tag">{t(cat)}</span> : null}
          {it.date ? <span className="tns-tag en" style={{ background: 'transparent', color: 'var(--muted)' }}>{it.date}</span> : null}
        </div>
        <h3 style={{ fontSize: 17, marginTop: 8 }}>{t(it.title)}</h3>
        {t(it.meta) ? <p style={{ fontSize: 14 }}>{t(it.meta)}</p> : null}
        {t(it.text) ? <p style={{ fontSize: 14, marginTop: 6 }} className="clamp3">{t(it.text)}</p> : null}
        {kind === 'PRODUCT' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
            {it.price != null ? <b className="en" dir="ltr">{it.price.toLocaleString('en-US')} {locale === 'ar' ? 'ج.م' : 'EGP'}</b> : <span />}
            {it.inStock ? <button type="button" className="tns-btn ghost sm" onClick={() => setForm({ kind: 'PRODUCT', page: 'products', topic: t(it.title) })}>{locale === 'ar' ? 'اطلب المنتج' : 'Order'}</button>
              : <span className="tns-tag" style={{ background: '#fdecec', color: '#9b1c1c' }}>{locale === 'ar' ? 'مش متاح دلوقتي' : 'Not available now'}</span>}
          </div>
        ) : kind === 'ACHIEVEMENT' ? <a className="more flip" href={`/achievements/${it.id}`}>{locale === 'ar' ? 'التفاصيل' : 'Details'} {arr}</a>
          : href ? <a className="more flip" href={href} target="_blank" rel="noopener noreferrer">{it.videoUrl ? (locale === 'ar' ? 'شوف الفيديو' : 'Watch') : locale === 'ar' ? 'اقرأ أكتر' : 'Read more'} {arr}</a> : null}
      </div>
    )
  })
  const filterChips = (kind: PublicItem['kind'], list: PublicItem[]) => {
    if (!listPage) return null
    const used = [...new Set(list.map((x) => x.category))]
    if (used.length < 2) return null
    const names = CATEGORIES[kind] as Record<string, Bi>
    return (
      <div className="tns-filter" role="group" aria-label={locale === 'ar' ? 'فلتر' : 'Filter'}>
        {['ALL', ...used].map((k) => <button key={k} type="button" className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{k === 'ALL' ? (locale === 'ar' ? 'الكل' : 'All') : names[k] ? t(names[k]) : k}</button>)}
      </div>
    )
  }
  const mediaCards = (items: MediaCard[], label?: (m: MediaCard) => string, order?: boolean) => items.map((m, i) => (
    <div key={i} className="tns-card tns-reveal" style={{ padding: 14, ['--d' as string]: `${Math.min(i, 8) * 70}ms` }}>
      <Sample on={m.sample} />
      <div className="tns-thumb"><Icon name={m.kind === 'video' ? 'play' : m.kind === 'competition' ? 'trophy' : m.kind === 'product' ? 'layers' : m.kind === 'event' ? 'route' : 'screen'} size={34} /></div>
      {label ? <span className="tns-tag" style={{ marginTop: 12 }}>{label(m)}</span> : null}
      <h3 style={{ fontSize: 17, marginTop: 10 }}>{t(m.title)}</h3>
      <p style={{ fontSize: 14 }}>{t(m.meta)}</p>
      {order ? <button type="button" className="tns-btn ghost sm" style={{ marginTop: 12 }} onClick={() => setForm({ kind: 'PRODUCT', page: 'products', topic: t(m.title) })}>{locale === 'ar' ? 'اطلب المنتج' : 'Order'}</button> : null}
    </div>
  ))

  return (
    <div className="tns" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
      {preview ? <div className="tns-preview">{locale === 'ar' ? 'نسخة تجريبية للمراجعة: مش ظاهرة للزوار. الكروت المكتوب عليها «مثال» مش هتظهر في الموقع الحقيقي.' : 'Review preview: not visible to visitors. Cards marked “Example” never appear on the real site.'}</div> : null}

      {banner ? (
        <a className="tns-banner" href={`/c/${banner.slug}`} onClick={() => track('CTA', `banner:${banner.slug}`)}>
          <span>{t(banner.banner ?? banner.title)}</span> <b>{arr}</b>
        </a>
      ) : null}

      {/* 01 header */}
      <header className={`tns-head${scrolled ? ' scrolled' : ''}`}>
        <div className="tns-wrap row">
          <a href={SITE_HOME} className="tns-logo" aria-label="TechNova">
            <span className="tns-mark">TN</span>
            <span className="tns-word">Tech<b>Nova</b></span>
          </a>
          <nav className="tns-nav" aria-label={locale === 'ar' ? 'القائمة الرئيسية' : 'Main menu'}>
            {nav.map((n) => <a key={n.href} href={n.href} className={pageOf(n.href) === page || (page === 'solution' && n.href === '/solutions') || (page === 'achievement' && n.href === '/achievements') ? 'on' : undefined} aria-current={pageOf(n.href) === page ? 'page' : undefined} onClick={() => track('NAV', n.label.en)}>{t(n.label)}</a>)}
          </nav>
          <div className="tns-tools">
            <button type="button" className="tns-icon-btn en" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} aria-label={locale === 'ar' ? 'English' : 'العربية'}>{locale === 'ar' ? 'EN' : 'ع'}</button>
            <button type="button" className="tns-icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={locale === 'ar' ? 'فاتح / غامق' : 'Light / dark'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{dark ? <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /> : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}</svg>
            </button>
            <a href="/login" className="tns-btn ghost sm hide-sm">{locale === 'ar' ? 'دخول' : 'Sign in'}</a>
            <a href="/signup" className="tns-btn ghost sm hide-sm">{locale === 'ar' ? 'اعمل حساب' : 'Sign up'}</a>
            <button type="button" className="tns-btn primary sm hide-sm" onClick={() => setForm({ kind: 'CONTACT', page: 'header' })}>{locale === 'ar' ? 'تواصل معانا' : 'Contact us'}</button>
            <button type="button" className="tns-icon-btn tns-burger" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={locale === 'ar' ? 'القائمة' : 'Menu'}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={menu ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
            </button>
          </div>
        </div>
        <div className={`tns-drawer${menu ? ' open' : ''}`}>
          {nav.map((n) => <a key={n.href} className="item" href={n.href} onClick={() => setMenu(false)}>{t(n.label)}</a>)}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <a href="/login" className="tns-btn ghost sm" style={{ flex: 1 }}>{locale === 'ar' ? 'دخول' : 'Sign in'}</a>
            <a href="/signup" className="tns-btn ghost sm" style={{ flex: 1 }}>{locale === 'ar' ? 'اعمل حساب' : 'Sign up'}</a>
            <button type="button" className="tns-btn primary sm" style={{ flex: 1 }} onClick={() => { setMenu(false); setForm({ kind: 'CONTACT', page: 'menu' }) }}>{locale === 'ar' ? 'تواصل معانا' : 'Contact us'}</button>
          </div>
        </div>
      </header>

      {!home ? (
        <section className="tns-band">
          <Circuit />
          <div className="tns-wrap" style={{ position: 'relative' }}>
            <nav className="crumbs" aria-label={locale === 'ar' ? 'مكانك' : 'Breadcrumb'}>
              <a href={SITE_HOME}>{locale === 'ar' ? 'الرئيسية' : 'Home'}</a> <span aria-hidden="true">/</span>{' '}
              {page === 'solution' ? <><a href="/solutions">{t(PAGE_TITLE.solutions)}</a> <span aria-hidden="true">/</span> </> : null}
              {page === 'course' || page === 'join' ? <><a href="/courses">{t(PAGE_TITLE.courses)}</a> <span aria-hidden="true">/</span> </> : null}
              {page === 'join' && courses[0] ? <><a href={`/courses/${courses[0].slug}`}>{t(courses[0].title)}</a> <span aria-hidden="true">/</span> </> : null}
              {page === 'achievement' ? <><a href="/achievements">{t(PAGE_TITLE.achievements)}</a> <span aria-hidden="true">/</span> </> : null}
            </nav>
            <h1>{page === 'join' && courses[0] ? `${locale === 'ar' ? 'التسجيل في' : 'Sign up for'} ${t(courses[0].title)}` : page === 'course' && courses[0] ? t(courses[0].title) : page === 'solution' && detail?.solution ? t(detail.solution.title) : page === 'achievement' && detail?.item ? t(detail.item.title) : page === 'campaign' && detail?.campaign ? t(detail.campaign.title) : t(PAGE_TITLE[page as keyof typeof PAGE_TITLE])}</h1>
          </div>
        </section>
      ) : null}

      {page === 'courses' ? (() => {
        const days = locale === 'ar' ? ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const band = AGE_BANDS.find((b) => b.key === ageFilter)
        const q = search.trim().toLowerCase()
        const list = courses.filter((c) => (modeFilter === 'ALL' || (modeFilter === 'ONLINE' ? c.modes.online : c.modes.recorded))
          && (!band || fitsBand(c, band)) && (!q || `${c.title.en} ${c.title.ar} ${c.summary.en} ${c.summary.ar}`.toLowerCase().includes(q)))
        const paths = list.filter((c) => c.refType === 'TRACK')
        const singles = list.filter((c) => c.refType === 'COURSE')
        const card = (c: PublicCourse, i: number) => {
          const from = fromPrice(c.price, c.on.price)
          const next = c.onlineGroups.find((g) => g.free == null || g.free > 0)
          const months = c.levels.reduce((a, l) => a + l.months, 0)
          return (
            <div key={c.slug} className="tns-card tns-reveal tns-course" style={{ padding: 0, overflow: 'hidden', ['--d' as string]: `${Math.min(i, 8) * 70}ms`, ['--band' as string]: c.color || 'var(--teal)' }}>
              <a href={`/courses/${c.slug}`} className="tns-course-img" aria-label={t(c.title)}>
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" loading="lazy" />
                ) : <span className="ph"><Icon name={c.refType === 'TRACK' ? 'route' : 'cap'} size={40} /></span>}
                {ageText(c.minAge, c.maxAge, locale === 'ar') ? <span className="age">{ageText(c.minAge, c.maxAge, locale === 'ar')}</span> : null}
              </a>
              <div style={{ padding: 18 }}>
                <span className="tns-tag">{c.refType === 'TRACK' ? (locale === 'ar' ? 'مسار كامل' : 'Full path') : (locale === 'ar' ? 'كورس' : 'Course')}{c.trackName ? ` · ${c.trackName}` : ''}</span>
                <h3 style={{ fontSize: 19, marginTop: 10 }}><a href={`/courses/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t(c.title)}</a></h3>
                {t(c.summary) ? <p className="clamp3" style={{ fontSize: 14 }}>{t(c.summary)}</p> : null}
                <ul className="tns-facts">
                  {c.levels.length ? <li><Icon name="layers" size={16} />{c.levels.length} {locale === 'ar' ? (c.levels.length === 1 ? 'مستوى' : 'مستويات') : (c.levels.length === 1 ? 'level' : 'levels')}{months ? ` · ${months} ${locale === 'ar' ? 'شهر' : 'months'}` : ''}</li> : null}
                  {c.modes.online ? <li><Icon name="screen" size={16} />{locale === 'ar' ? 'لايف أونلاين' : 'Live online'}</li> : null}
                  {c.modes.recorded ? <li><Icon name="play" size={14} />{locale === 'ar' ? 'مسجل، في أي وقت' : 'Recorded, any time'}</li> : null}
                  {next ? <li><Icon name="route" size={16} />{locale === 'ar' ? 'أقرب ميعاد' : 'Next group'}: {next.slots.map((x) => `${days[x.dayOfWeek]} ${x.time}`).join(' · ')}{next.free != null ? ` · ${locale === 'ar' ? `فاضل ${next.free}` : `${next.free} seats left`}` : ''}</li> : null}
                </ul>
                <div className="tns-course-foot">
                  {from != null ? <span>{locale === 'ar' ? 'يبدأ من' : 'From'} <b className="en">{from.toLocaleString('en-US')}</b> {locale === 'ar' ? 'ج.م' : 'EGP'}</span> : <span />}
                  <a className="tns-btn brand sm" href={`/courses/${c.slug}`}>{locale === 'ar' ? 'التفاصيل' : 'Details'}</a>
                </div>
              </div>
            </div>
          )
        }
        return (
          <section className="tns-sec" style={{ paddingTop: 40 }}>
            <div className="tns-wrap">
              <div className="tns-picker">
                <p className="lbl">{locale === 'ar' ? 'سن الطالب' : "Student's age"}</p>
                <div className="tns-filter" role="group" aria-label={locale === 'ar' ? 'السن' : 'Age'}>
                  <button type="button" className={!ageFilter ? 'on' : ''} onClick={() => setAgeFilter('')}>{locale === 'ar' ? 'كل الأعمار' : 'All ages'}</button>
                  {AGE_BANDS.map((b) => <button key={b.key} type="button" className={ageFilter === b.key ? 'on' : ''} onClick={() => setAgeFilter(b.key)}><span className="tns-num">{locale === 'ar' ? b.ar : b.en}</span></button>)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 12 }}>
                  <div className="tns-filter" role="group" aria-label={locale === 'ar' ? 'طريقة التعلم' : 'How'} style={{ marginTop: 0 }}>
                    {(['ALL', 'ONLINE', 'RECORDED'] as const).map((k) => <button key={k} type="button" className={modeFilter === k ? 'on' : ''} onClick={() => setModeFilter(k)}>{k === 'ALL' ? (locale === 'ar' ? 'أي طريقة' : 'Any way') : k === 'ONLINE' ? (locale === 'ar' ? 'لايف أونلاين' : 'Live online') : (locale === 'ar' ? 'مسجل' : 'Recorded')}</button>)}
                  </div>
                  <label className="tns-search"><span className="sr">{locale === 'ar' ? 'دوّر' : 'Search'}</span>
                    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={locale === 'ar' ? 'دوّر على كورس…' : 'Search a course…'} />
                  </label>
                </div>
              </div>

              {list.length === 0 ? <p className="tns-lead" style={{ marginTop: 30 }}>{locale === 'ar' ? 'مفيش كورسات بالاختيار ده دلوقتي.' : 'No courses match this right now.'}</p> : null}
              {paths.length ? <>
                <div className="tns-head-row" style={{ marginTop: 36 }}><h2 className="tns-h2" style={{ fontSize: 26 }}>{locale === 'ar' ? 'مسارات كاملة' : 'Full paths'}</h2><span style={{ color: 'var(--muted)' }}>{locale === 'ar' ? 'رحلة من مستوى لمستوى، بنحدد ابنك يبدأ منين' : 'A journey level by level; we set where your child starts'}</span></div>
                <div className="tns-grid" style={{ ['--min' as string]: '300px', marginTop: 16 }}>{paths.map(card)}</div>
              </> : null}
              {singles.length ? <>
                <div className="tns-head-row" style={{ marginTop: 44 }}><h2 className="tns-h2" style={{ fontSize: 26 }}>{locale === 'ar' ? 'كورسات' : 'Courses'}</h2><span style={{ color: 'var(--muted)' }}>{locale === 'ar' ? 'كورس واحد في موضوع محدد' : 'One course on one subject'}</span></div>
                <div className="tns-grid" style={{ ['--min' as string]: '300px', marginTop: 16 }}>{singles.map(card)}</div>
              </> : null}

              <div className="tns-help tns-reveal">
                <div>
                  <h3 style={{ margin: 0 }}>{locale === 'ar' ? 'محتار تختار إيه؟' : 'Not sure what to choose?'}</h3>
                  <p style={{ margin: '6px 0 0' }}>{locale === 'ar' ? 'قولّنا سن ابنك وبيحب إيه، وإحنا نرشّحلك المناسب.' : "Tell us your child's age and interests and we'll suggest the right one."}</p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button type="button" className="tns-btn brand" onClick={() => setForm({ kind: 'CONTACT', page: 'courses:help', topic: locale === 'ar' ? 'مساعدة في اختيار كورس' : 'Help choosing a course' })}>{locale === 'ar' ? 'ساعدني أختار' : 'Help me choose'}</button>
                  {wa ? <a className="tns-btn ghost" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track('WHATSAPP', 'courses:help')}>{locale === 'ar' ? 'واتساب' : 'WhatsApp'}</a> : null}
                </div>
              </div>
            </div>
          </section>
        )
      })() : null}

      {page === 'join' && courses[0] ? (
        <section className="tns-sec"><div className="tns-wrap">
          {courses[0].modes.online || courses[0].modes.recorded ? <SignupWizard course={courses[0]} />
            : <div className="tns-card"><p>{locale === 'ar' ? 'التسجيل من الموقع مش مفتوح للكورس ده لسه. سجّل اهتمامك وهنكلمك.' : 'Online sign-up is not open for this course yet. Register your interest and we will call you.'}</p>
              <button type="button" className="tns-btn brand" style={{ marginTop: 12 }} onClick={() => setForm({ kind: 'CONTACT', page: `join:${courses[0].slug}`, topic: t(courses[0].title).slice(0, 80) })}>{locale === 'ar' ? 'سجّل اهتمامك' : 'Register your interest'}</button></div>}
        </div></section>
      ) : null}

      {page === 'course' && courses[0] ? (() => {
        const c = courses[0]
        const days = locale === 'ar' ? ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const yt = youtubeEmbed(c.introVideoUrl)
        const sx = c.sections as Record<string, { items?: Bi[] | { q: Bi; a: Bi }[]; videoUrl?: string | null; name?: Bi; bio?: Bi; photoUrl?: string | null }>
        const pv = youtubeEmbed(sx.preview?.videoUrl)
        const money = (n: number | null) => (n == null ? '' : `${n.toLocaleString('en-US')} ${locale === 'ar' ? 'ج.م' : 'EGP'}`)
        const projects = items.filter((x) => x.kind === 'ACHIEVEMENT' && x.category === 'PROJECT').slice(0, 3)
        const H = ({ children }: { children: React.ReactNode }) => <h2 className="tns-h2" style={{ fontSize: 24, marginTop: 36 }}>{children}</h2>
        return (
          <section className="tns-sec">
            <div className="tns-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 36, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 520px', minWidth: 0 }}>
                {yt ? <div className="tns-embed"><iframe src={yt} title={t(c.title)} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
                  : c.introVideoUrl ? <video className="tns-embed" src={c.introVideoUrl} controls playsInline preload="metadata" />
                  : c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="tns-embed" src={c.imageUrl} alt="" />
                  ) : null}
                {t(c.summary) ? <p className="tns-lead" style={{ marginTop: 20, whiteSpace: 'pre-line' }}>{t(c.summary)}</p> : null}
                {c.on.outcomes && (sx.outcomes?.items as Bi[] | undefined)?.length ? <><H>{locale === 'ar' ? 'بعد الكورس ابنك هيقدر…' : 'After the course your child can…'}</H><ul className="tns-checks">{(sx.outcomes!.items as Bi[]).map((o, i) => <li key={i}><Icon name="check" size={18} />{t(o)}</li>)}</ul></> : null}
                {c.on.levels && c.levels.length ? <><H>{locale === 'ar' ? 'المستويات والمدة' : 'Levels and duration'}</H><ol className="tns-steps">{c.levels.map((lv, i) => <li key={i}><b className="en">{String(i + 1).padStart(2, '0')}</b><span>{c.refType === 'TRACK' ? `${lv.course} — ` : ''}{lv.name} · <span className="tns-num">{lv.sessions}</span> {locale === 'ar' ? 'حصة' : 'sessions'} · <span className="tns-num">{lv.months}</span> {locale === 'ar' ? 'شهر' : 'months'}</span></li>)}</ol></> : null}
                {c.on.sessions && c.sessionsTitles.length ? <><H>{locale === 'ar' ? 'الحصص' : 'Sessions'}</H><ol className="tns-steps">{c.sessionsTitles.map((x, i) => <li key={i}><b className="en">{String(i + 1).padStart(2, '0')}</b>{t(x)}</li>)}</ol></> : null}
                {c.on.preview && (pv || sx.preview?.videoUrl) ? <><H>{locale === 'ar' ? 'اتفرج على درس مجاناً' : 'Watch a free lesson'}</H>{pv ? <div className="tns-embed"><iframe src={pv} title="preview" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div> : <video className="tns-embed" src={sx.preview!.videoUrl!} controls playsInline preload="metadata" />}</> : null}
                {c.on.projects && projects.length ? <><H>{locale === 'ar' ? 'مشاريع الطلاب' : 'Student projects'}</H><div className="tns-grid" style={{ ['--min' as string]: '220px', marginTop: 16 }}>{itemCards(projects, 'ACHIEVEMENT')}</div></> : null}
                {c.on.requirements && (sx.requirements?.items as Bi[] | undefined)?.length ? <><H>{locale === 'ar' ? 'محتاج إيه' : 'What you need'}</H><ul className="tns-checks">{(sx.requirements!.items as Bi[]).map((o, i) => <li key={i}><Icon name="tools" size={18} />{t(o)}</li>)}</ul></> : null}
                {c.on.instructor && sx.instructor?.name && t(sx.instructor.name) ? <><H>{locale === 'ar' ? 'المدرب' : 'The instructor'}</H><div className="tns-card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>{sx.instructor.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sx.instructor.photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                ) : null}<div><h3 style={{ margin: 0 }}>{t(sx.instructor.name)}</h3>{sx.instructor.bio ? <p>{t(sx.instructor.bio)}</p> : null}</div></div></> : null}
                {c.on.certificate ? <><H>{locale === 'ar' ? 'الشهادة' : 'The certificate'}</H><p className="tns-lead">{locale === 'ar' ? 'في آخر كل مستوى الطالب بياخد شهادة برقم وQR، وأي حد يقدر يتأكد منها.' : 'At the end of every level the student gets a numbered certificate with a QR code anyone can check.'} <a href="/verify">{locale === 'ar' ? 'جرّب تتأكد من شهادة' : 'Check a certificate'}</a></p></> : null}
                {c.on.nextLevel && c.nextLevel ? <><H>{locale === 'ar' ? 'الخطوة الجاية' : 'What comes next'}</H><p className="tns-lead">{c.nextLevel.slug ? <a href={`/courses/${c.nextLevel.slug}`}>{c.nextLevel.title} {arr}</a> : c.nextLevel.title}</p></> : null}
                {c.on.faq && (sx.faq?.items as { q: Bi; a: Bi }[] | undefined)?.length ? <><H>{locale === 'ar' ? 'أسئلة' : 'Questions'}</H><div className="tns-faq">{(sx.faq!.items as { q: Bi; a: Bi }[]).map((f, i) => <details key={i}><summary>{t(f.q)}</summary><p>{t(f.a)}</p></details>)}</div></> : null}
              </div>
              <aside className="tns-card" style={{ flex: '1 1 320px', minWidth: 0, position: 'sticky', top: 90 }}>
                {ageText(c.minAge, c.maxAge, locale === 'ar') ? <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)' }}>{ageText(c.minAge, c.maxAge, locale === 'ar')}</p> : null}
                {c.modes.online ? (
                  <div style={{ marginTop: 14 }}>
                    <h3 style={{ margin: 0 }}>{locale === 'ar' ? 'لايف أونلاين' : 'Live online'}</h3>
                    {c.on.price && c.price.online != null ? <p style={{ margin: '4px 0 0', fontWeight: 700, color: 'var(--text)' }}>{money(c.price.online)} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>/ {c.price.onlinePer === 'MONTH' ? (locale === 'ar' ? 'شهر' : 'month') : (locale === 'ar' ? 'المستوى' : 'level')}</span></p> : null}
                    <ul className="tns-groups">{c.onlineGroups.map((g) => <li key={g.id}><span>{g.slots.map((x) => `${days[x.dayOfWeek]} ${x.time}`).join(' · ') || g.name}</span><b>{g.free == null ? '' : g.free > 0 ? `${g.free} ${locale === 'ar' ? 'أماكن' : 'seats'}` : (locale === 'ar' ? 'كامل' : 'Full')}</b></li>)}</ul>
                    <p style={{ fontSize: 12, margin: '6px 0 0' }}>{locale === 'ar' ? 'المواعيد بتوقيت القاهرة' : 'Times are Cairo time'}</p>
                  </div>
                ) : null}
                {c.modes.recorded ? (
                  <div style={{ marginTop: 18 }}>
                    <h3 style={{ margin: 0 }}>{locale === 'ar' ? 'كورس مسجل' : 'Recorded course'}</h3>
                    {c.on.price && c.price.recorded != null ? <p style={{ margin: '4px 0 0', fontWeight: 700, color: 'var(--text)' }}>{money(c.price.recorded)}{c.price.recordedDays ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> / {c.price.recordedDays} {locale === 'ar' ? 'يوم' : 'days'}</span> : null}</p> : null}
                    <p style={{ fontSize: 13, margin: '4px 0 0' }}>{locale === 'ar' ? 'تتفرج في أي وقت، وتاخد شهادة.' : 'Watch any time, and get a certificate.'}</p>
                  </div>
                ) : null}
                {!c.modes.online && !c.modes.recorded ? <p>{locale === 'ar' ? 'المواعيد الجديدة هتنزل قريب.' : 'New dates are coming soon.'}</p> : null}
                {c.modes.online || c.modes.recorded ? <a className="tns-btn brand" style={{ marginTop: 20, width: '100%' }} href={`/join/${c.slug}`} onClick={() => track('CTA', `course:${c.slug}:join`)}>{locale === 'ar' ? 'سجّل دلوقتي' : 'Sign up now'}</a>
                  : <button type="button" className="tns-btn brand" style={{ marginTop: 20, width: '100%' }} onClick={() => setForm({ kind: 'CONTACT', page: `course:${c.slug}`, topic: t(c.title).slice(0, 80) })}>{locale === 'ar' ? 'سجّل اهتمامك' : 'Register your interest'}</button>}
                {wa ? <a className="tns-btn ghost" style={{ marginTop: 10, width: '100%' }} href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track('WHATSAPP', `course:${c.slug}`)}>{locale === 'ar' ? 'اسأل على الواتساب' : 'Ask on WhatsApp'}</a> : null}
              </aside>
            </div>
          </section>
        )
      })() : null}

      {page === 'campaign' && detail?.campaign ? (() => {
        const cp = detail.campaign
        const yt = youtubeEmbed(cp.videoUrl)
        const soon = cp.state === 'UPCOMING'
        const fmt = (d: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(`${d}T12:00:00Z`))
        return (
          <section className="tns-sec">
            <div className="tns-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 36, alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 460px', minWidth: 0 }}>
                {yt ? <div className="tns-embed"><iframe src={yt} title={t(cp.title)} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
                  : cp.videoUrl ? <video className="tns-embed" src={cp.videoUrl} controls playsInline preload="metadata" />
                  : cp.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="tns-embed" src={cp.imageUrl} alt="" />
                  ) : null}
                {t(cp.text) ? <p className="tns-lead" style={{ marginTop: 20, whiteSpace: 'pre-line' }}>{t(cp.text)}</p> : null}
              </div>
              <div className="tns-card" style={{ flex: '1 1 320px', minWidth: 0, position: 'sticky', top: 90 }}>
                {t(cp.offer) ? <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t(cp.offer)}</p> : null}
                {cp.startsAt || cp.endsAt ? <p style={{ marginTop: 8 }}>{cp.startsAt ? `${locale === 'ar' ? 'من' : 'From'} ${fmt(cp.startsAt)} ` : ''}{cp.endsAt ? `${locale === 'ar' ? 'لحد' : 'until'} ${fmt(cp.endsAt)}` : ''}</p> : null}
                {soon ? <p className="tns-tag" style={{ marginTop: 14 }}>{locale === 'ar' ? 'التسجيل لسه مابدأش' : 'Registration has not opened yet'}</p> : (
                  <button type="button" className="tns-btn brand" style={{ marginTop: 18, width: '100%' }} onClick={() => setForm({ kind: (cp.formKind as RequestKind) ?? 'CONTACT', page: `campaign:${cp.slug}`, topic: t(cp.title).slice(0, 80) })}>{locale === 'ar' ? 'سجّل اهتمامك' : 'Register your interest'}</button>
                )}
                {wa ? <a className="tns-btn ghost" style={{ marginTop: 10, width: '100%' }} href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track('WHATSAPP', `campaign:${cp.slug}`)}>{locale === 'ar' ? 'اسأل على الواتساب' : 'Ask on WhatsApp'}</a> : null}
              </div>
            </div>
          </section>
        )
      })() : null}

      {page === 'solution' && detail?.solution ? (
        <section className="tns-sec">
          <div className="tns-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <span className="tns-ico" style={{ width: 64, height: 64 }}><Icon name={detail.solution.icon ?? 'chip'} size={30} /></span>
              <p className="tns-lead" style={{ marginTop: 18 }}>{t(detail.solution.text)}</p>
              <p className="tns-lead" style={{ marginTop: 10 }}>{t(C.solutions.text)}</p>
              <button type="button" className="tns-btn brand" style={{ marginTop: 24 }} onClick={() => setForm({ kind: 'SOLUTION', page: `solution:${slugify(detail.solution!.title.en)}`, topic: t(detail.solution!.title) })}>{t(C.solutions.cta)}</button>
            </div>
            <div className="tns-card" style={{ flex: '1 1 340px', minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>{locale === 'ar' ? 'إزاي بنشتغل' : 'How we work'}</h3>
              <ol className="tns-steps">
                {[['We listen to the problem', 'بنسمع المشكلة'], ['We visit and assess', 'بنزور ونقيّم'], ['We propose the solution and its price', 'بنقترح الحل وسعره'], ['We build it and follow up', 'بننفّذ ونتابع']].map(([en, ar], i) => <li key={i}><b className="en">0{i + 1}</b>{locale === 'ar' ? ar : en}</li>)}
              </ol>
            </div>
          </div>
          <div className="tns-wrap" style={{ marginTop: 56 }}>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{locale === 'ar' ? 'حلول تانية' : 'Other solutions'}</h2>
            <div className="tns-grid" style={{ ['--min' as string]: '240px' }}>{cards(C.solutions.items.filter((x) => x.title.en !== detail.solution!.title.en), false, (c) => `/solutions/${slugify(c.title.en)}`)}</div>
          </div>
        </section>
      ) : null}

      {page === 'achievement' && detail?.item ? (() => {
        const it = detail.item
        const yt = youtubeEmbed(it.videoUrl)
        const cat = (CATEGORIES.ACHIEVEMENT as Record<string, Bi>)[it.category]
        return (
          <section className="tns-sec">
            <div className="tns-wrap" style={{ maxWidth: 900 }}>
              {yt ? <div className="tns-embed"><iframe src={yt} title={t(it.title)} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
                : it.videoUrl ? <video className="tns-embed" src={it.videoUrl} controls playsInline preload="metadata" />
                : it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="tns-embed" src={it.imageUrl} alt="" />
                ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 20 }}>
                {cat ? <span className="tns-tag">{t(cat)}</span> : null}
                {it.date ? <span className="tns-tag en" style={{ background: 'transparent', color: 'var(--muted)' }}>{it.date}</span> : null}
              </div>
              {t(it.meta) ? <p className="tns-lead" style={{ marginTop: 12, fontWeight: 600 }}>{t(it.meta)}</p> : null}
              {t(it.text) ? <p className="tns-lead" style={{ marginTop: 12, whiteSpace: 'pre-line' }}>{t(it.text)}</p> : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
                {it.linkUrl ? <a className="tns-btn brand" href={it.linkUrl} target="_blank" rel="noopener noreferrer">{locale === 'ar' ? 'اعرف أكتر' : 'Learn more'}</a> : null}
                <a className="tns-btn ghost" href="/achievements">{locale === 'ar' ? 'كل الإنجازات' : 'All achievements'}</a>
              </div>
            </div>
          </section>
        )
      })() : null}

      {/* 02 hero + audience */}
      {on('hero') && (C.hero.show !== false) ? (
        <section id="top" className="tns-hero">
          <div className="shape" aria-hidden="true"><i className="s1" /><i className="s2" /><i className="s3" /></div>
          <div className="tns-wrap">
            <div className="row">
              <div className="copy">
                <span className="pill">{C.hero.kicker}</span>
                <h1>{t(C.hero.title1)}<span>{t(C.hero.title2)}</span></h1>
                <p className="tagline">{C.hero.tagline}</p>
                <p className="text">{t(C.hero.text)}</p>
                <div className="btns">
                  <a href="#divisions" className="tns-btn brand">{t(C.hero.primary)}</a>
                  <button type="button" className="tns-btn ghost" onClick={() => setForm({ kind: 'CONTACT', page: 'hero' })}>{t(C.hero.secondary)}</button>
                </div>
              </div>
              <div className="media">
                <div className="tns-video">
                  {C.hero.videoUrl ? (
                    <video src={C.hero.videoUrl} controls playsInline muted preload="metadata" />
                  ) : (
                    <>
                      <Circuit />
                      <div className="visual">
                        <div className="big">Tech<b>Nova</b></div>
                        <div className="sub">LEARN · BUILD · INNOVATE</div>
                      </div>
                      {preview ? <div className="note">{locale === 'ar' ? 'هنا هيتحط فيديو كيرلس عن الشركة' : "The founder's video goes here"}</div> : null}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="tns-aud">
              {visible(C.audience, preview).map((a, i) => (
                <a key={i} href={pageHref(a.href)} onClick={() => track('AUDIENCE', a.title.en)}>
                  <span className="n">0{i + 1}</span>
                  <strong>{t(a.title)}</strong>
                  <span className="t">{t(a.text)}</span>
                  {a.cta ? <span className="c">{t(a.cta)} {arr}</span> : null}
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 02b field tiles */}
      {on('fields') && (C.fields.show !== false && visible(C.fields.items, preview).length) ? (
        <section className="tns-fields-sec">
          <div className="tns-wrap">
            <h2 className="tns-h2" style={{ fontSize: 'clamp(22px, 2.6vw, 30px)', textAlign: 'center' }}>{t(C.fields.title)}</h2>
            <div className="tns-tiles">
              {visible(C.fields.items, preview).map((f, i) => (
                <a key={i} href={f.href ?? '#curriculum'} className="tns-tile tns-reveal" style={{ ['--d' as string]: `${i * 70}ms` }} onClick={() => track('CTA', `field:${f.title.en}`)}>
                  <span className="ic"><Icon name={f.icon ?? 'code'} size={26} /></span>
                  <strong>{t(f.title)}</strong>
                  <span>{t(f.text)}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 03 numbers */}
      {on('numbers') && (numbers.length) ? (
        <section style={{ background: 'var(--surface)', borderBlock: '1px solid var(--line)' }}>
          <div className="tns-wrap tns-stats">
            {numbers.slice(0, 4).map(({ i, value }) => (
              <div key={i}><div className="v"><CountUp value={value} plus={C.stats[i].plus} /></div><div className="l">{t(C.stats[i].label)}</div></div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 04 about */}
      {on('about') && (C.about.show !== false) ? (
        <section id="about" className="tns-sec">
          <div className="tns-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'center' }}>
            <div className="tns-reveal" style={{ flex: '1 1 440px', minWidth: 0 }}>
              <p className="tns-kick">Who we are · {locale === 'ar' ? 'مين إحنا' : 'TechNova'}</p>
              {head(C.about.title, 'about')}
              <p className="tns-lead">{t(C.about.text)}</p>
            </div>
            <div className="tns-chain tns-reveal" style={{ flex: '1 1 440px', minWidth: 0 }}>
              {C.about.steps.map((s, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  {i > 0 ? <span className="arr"><Icon name="arrow" /></span> : null}
                  <div className="node"><b>{t(s)}</b><small>{s.en}</small></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 05 divisions */}
      {on('divisions') && (C.divisions.show !== false) ? (
        <section id="divisions" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Our divisions</p>
            <h2 className="tns-h2">{t(C.divisions.title)}</h2>
            <div className="tns-grid" style={{ ['--min' as string]: '240px' }}>{cards(C.divisions.items)}</div>
          </div>
        </section>
      ) : null}

      {/* 06 education: families (B2C) + schools (B2B) + journey */}
      {on('education') && (C.education.show !== false) ? (
        <section id="education" className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Education</p>
            {head(C.education.title, 'education')}
            <p className="tns-lead">{t(C.education.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '400px' }}>
              <div className="tns-card tns-reveal">
                <span className="tns-tag">{t(C.education.families.tag!)}</span>
                <h3 style={{ fontSize: 23 }}>{t(C.education.families.title)}</h3>
                <p>{t(C.education.families.text)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>{C.education.ages.map((a) => <span key={a} className="tns-chip en"><span className="tns-num">{a}</span></span>)}</div>
                <a className="more flip" href={C.education.families.href}>{t(C.education.families.cta!)} {arr}</a>
              </div>
              <div id="schools" className="tns-card tns-reveal">
                <span className="tns-tag">{t(C.education.schools.tag!)}</span>
                <h3 style={{ fontSize: 23 }}>{t(C.education.schools.title)}</h3>
                <p>{t(C.education.schools.text)}</p>
                <button type="button" className="tns-btn brand" style={{ marginTop: 18 }} onClick={() => setForm({ kind: 'SCHOOL', page: 'education' })}>{t(C.education.schools.cta!)}</button>
              </div>
            </div>
            <h3 style={{ fontSize: 21, margin: '48px 0 0' }}>{locale === 'ar' ? 'رحلة الطالب مع TechNova' : 'The student journey'}</h3>
            <div className="tns-journey">
              {C.education.journey.map((j, i) => <div key={j.step} className="tns-reveal"><b>0{i + 1} · {j.step}</b><p>{t(j)}</p></div>)}
            </div>
          </div>
        </section>
      ) : null}

      {/* 07 curriculum quality */}
      {on('curriculum') && (C.curriculum.show !== false) ? (
        <section id="curriculum" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Our curriculum</p>
            <h2 className="tns-h2">{t(C.curriculum.title)}</h2>
            <p className="tns-lead">{t(C.curriculum.text)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22 }}>
              {visible(C.curriculum.programmes, preview).map((p) => <span key={p.name} className="tns-chip"><b className="en" style={{ marginInlineEnd: 6 }}>{p.name}</b>{t(p.ages)}</span>)}
            </div>
            <div className="tns-grid" style={{ ['--min' as string]: '300px' }}>{cards(C.curriculum.points)}</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '16px 0 0' }}>{t(C.curriculum.note)}</p>
          </div>
        </section>
      ) : null}

      {/* 08 solutions (dark + circuit) */}
      {on('solutions') && (C.solutions.show !== false) ? (
        <section id="solutions" className="tns-sec dark tns-reveal">
          <Circuit />
          <div className="tns-wrap" style={{ position: 'relative' }}>
            <p className="tns-kick">Our solutions</p>
            {head(C.solutions.title, 'solutions')}
            <p className="tns-lead">{t(C.solutions.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '260px' }}>{cards(C.solutions.items, true, (c) => `/solutions/${slugify(c.title.en)}`)}</div>
            <div style={{ marginTop: 30 }}><button type="button" className="tns-btn primary" onClick={() => setForm({ kind: 'SOLUTION', page: 'solutions' })}>{t(C.solutions.cta)}</button></div>
          </div>
        </section>
      ) : null}

      {/* 09 why */}
      {on('why') && (C.why.show !== false) ? (
        <section className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Why TechNova</p>
            <h2 className="tns-h2">{t(C.why.title)}</h2>
            <div className="tns-grid" style={{ ['--min' as string]: '300px' }}>{cards(C.why.items)}</div>
          </div>
        </section>
      ) : null}

      {/* 10 achievements & projects */}
      {on('achievements') && (C.achievements.show !== false && (achievements.length || realAchievements.length)) ? (
        <section id="achievements" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Ideas in action</p>
            {head(C.achievements.title, 'achievements')}
            <p className="tns-lead">{t(C.achievements.text)}</p>
            {filterChips('ACHIEVEMENT', realAchievements)}
            <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{realAchievements.length ? itemCards(realAchievements, 'ACHIEVEMENT') : mediaCards(achievements)}</div>
          </div>
        </section>
      ) : null}

      {/* 11 certificate check */}
      {on('verify') && (C.verify.show !== false) ? (
        <section id="verify" className="tns-sec" style={{ paddingBlock: 64 }}>
          <div className="tns-wrap">
            {detail?.certificate ? (() => {
              const r = detail.certificate.result
              const ok = !!r?.valid
              const date = r ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(r.issuedDate)) : ''
              return (
                <div className={`tns-cert ${ok ? 'ok' : 'bad'}`} role="status">
                  <span className="mark" aria-hidden="true"><Icon name={ok ? 'check' : 'shield'} size={30} /></span>
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <p className="state">{!r ? (locale === 'ar' ? 'مفيش شهادة بالرقم ده' : 'No certificate with this number') : ok ? (locale === 'ar' ? 'شهادة سليمة ✓' : 'Valid certificate ✓') : r.status === 'REVOKED' ? (locale === 'ar' ? 'الشهادة دي اتلغت' : 'This certificate was revoked') : (locale === 'ar' ? 'الشهادة دي مش سارية' : 'This certificate is not valid')}</p>
                    <p className="en num" dir="ltr">{detail.certificate.number}</p>
                    {r ? (
                      <dl>
                        <div><dt>{locale === 'ar' ? 'اسم الطالب' : 'Student'}</dt><dd>{r.studentName}</dd></div>
                        <div><dt>{locale === 'ar' ? 'الشهادة' : 'Certificate'}</dt><dd>{r.title}</dd></div>
                        {r.courseName ? <div><dt>{locale === 'ar' ? 'الكورس' : 'Course'}</dt><dd>{r.courseName}</dd></div> : null}
                        <div><dt>{locale === 'ar' ? 'تاريخ الإصدار' : 'Issued on'}</dt><dd>{date}</dd></div>
                        {r.revokedReason ? <div><dt>{locale === 'ar' ? 'السبب' : 'Reason'}</dt><dd>{r.revokedReason}</dd></div> : null}
                      </dl>
                    ) : <p style={{ color: 'var(--muted)' }}>{locale === 'ar' ? 'اتأكد إن الرقم مكتوب زي ما هو على الشهادة، أو امسح الـ QR تاني.' : 'Check the number is typed exactly as on the certificate, or scan the QR again.'}</p>}
                  </div>
                </div>
              )
            })() : null}
            <div className="tns-card tns-reveal" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
              <span className="tns-ico" style={{ width: 64, height: 64 }}><Icon name="shield" size={30} /></span>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <h2 className="tns-h2" style={{ fontSize: 28, margin: 0 }}>{t(C.verify.title)}</h2>
                <p style={{ marginTop: 6 }}>{t(C.verify.text)}</p>
                <form className="tns-verify" onSubmit={(e) => { e.preventDefault(); if (cert.trim()) router.push(`/verify/${encodeURIComponent(cert.trim().toUpperCase())}`) }}>
                  <label htmlFor="tns-cert" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t(C.verify.title)}</label>
                  <input id="tns-cert" dir="ltr" value={cert} onChange={(e) => setCert(e.target.value)} placeholder="TN-CERT-2026-00001" />
                  <button type="submit" className="tns-btn brand">{locale === 'ar' ? 'تأكّد' : 'Check'}</button>
                </form>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 12 products */}
      {on('products') && (C.products.show !== false && (products.length || realProducts.length)) ? (
        <section id="products" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Products</p>
            {head(C.products.title, 'products')}
            <p className="tns-lead">{t(C.products.text)}</p>
            {filterChips('PRODUCT', realProducts)}
            <div className="tns-grid" style={{ ['--min' as string]: '240px' }}>{realProducts.length ? itemCards(realProducts, 'PRODUCT') : mediaCards(products, (m) => t((m as MediaCard & { type: Bi }).type), true)}</div>
          </div>
        </section>
      ) : null}

      {/* 13 partnerships */}
      {on('partners') && (C.partners.show !== false) ? (
        <section id="partners" className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Partnerships</p>
            {head(C.partners.title, 'partners')}
            <p className="tns-lead">{t(C.partners.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '210px' }}>{cards(C.partners.kinds)}</div>
            {visible(C.partners.places, preview).length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>{visible(C.partners.places, preview).map((p, i) => <span key={i} className="tns-chip">{t(p.name)}</span>)}</div>
            ) : null}
            <div style={{ marginTop: 28 }}><button type="button" className="tns-btn brand" onClick={() => setForm({ kind: 'PARTNER', page: 'partners' })}>{locale === 'ar' ? 'قدّم طلب شراكة' : 'Apply for a partnership'}</button></div>
          </div>
        </section>
      ) : null}

      {/* 14 events + media */}
      {on('media') && ((C.events.show !== false && events.length) || (C.media.show !== false && (media.length || realMedia.length))) ? (
        <section id="media" className="tns-sec alt">
          <div className="tns-wrap">
            {C.events.show !== false && events.length ? (
              <div style={{ marginBottom: 48 }}>
                <p className="tns-kick">Events</p>
                <h2 className="tns-h2">{t(C.events.title)}</h2>
                <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{mediaCards(events)}</div>
              </div>
            ) : null}
            {C.media.show !== false && (media.length || realMedia.length) ? (
              <>
                <p className="tns-kick">Media & news</p>
                {head(C.media.title, 'media')}
                {filterChips('MEDIA', realMedia)}
                <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{realMedia.length ? itemCards(realMedia, 'MEDIA') : mediaCards(media, (m) => t(m.meta))}</div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 15 call to action + contact */}
      <section id="contact" className="tns-sec" style={{ paddingTop: 64 }}>
        <div className="tns-wrap">
          <div className="tns-reveal" style={{ position: 'relative', overflow: 'hidden', background: 'var(--brand)', borderRadius: 26, padding: '56px 28px', textAlign: 'center', color: '#fff' }}>
            <Circuit />
            <div style={{ position: 'relative' }}>
              <h2 className="tns-h2">{t(C.cta.title)}</h2>
              <p className="tns-lead" style={{ margin: '0 auto', color: '#cfe0ec' }}>{t(C.cta.text)}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 26 }}>
                <button type="button" className="tns-btn primary" onClick={() => setForm({ kind: 'CONTACT', page: 'contact' })}>{locale === 'ar' ? 'ابعتلنا رسالة' : 'Send us a message'}</button>
                {wa ? <a href={wa} onClick={() => track('WHATSAPP', 'contact')} target="_blank" rel="noopener noreferrer" className="tns-btn ghost" style={{ borderColor: '#5d8bb0', color: '#fff' }}>{locale === 'ar' ? 'كلّمنا واتساب' : 'WhatsApp us'}</a> : null}
                {C.contact.phone ? <a href={`tel:${C.contact.phone}`} className="tns-btn ghost ghost-d" style={{ borderColor: '#5d8bb0', color: '#fff' }}>{C.contact.phone}</a> : null}
                {C.contact.email ? <a href={`mailto:${C.contact.email}`} className="tns-btn ghost" style={{ borderColor: '#5d8bb0', color: '#fff' }}>{C.contact.email}</a> : null}
              </div>
              <p style={{ margin: '18px 0 0', color: '#cfe0ec', fontSize: 15 }}>{t(C.contact.address)}</p>
              {preview && !wa ? <p style={{ margin: '10px 0 0', color: '#fff1d6', fontSize: 13 }}>{locale === 'ar' ? 'رقم الواتساب والتليفون والإيميل بيتكتبوا من شاشة «الموقع» في السيستم. وزرار «احجز حصة تجريبية» هييجي بعد خطوات التسجيل.' : 'WhatsApp, phone and email are set in the system ("Website" screen). “Book a trial” comes after the registration process.'}</p> : null}
            </div>
          </div>
        </div>
      </section>

      {/* 16 footer */}
      <footer className="tns-foot">
        <div className="tns-wrap">
          <div className="cols">
            <div>
              <div className="tns-word" style={{ color: '#fff' }}>Tech<b style={{ color: 'var(--cyan)' }}>Nova</b></div>
              <p style={{ lineHeight: 1.8, fontSize: 14 }}>{locale === 'ar' ? 'شركة تكنولوجيا في الغردقة: تعليم، حلول ذكية، وابتكار.' : 'A technology company in Hurghada: education, smart solutions and innovation.'}</p>
            </div>
            <div><h4>{locale === 'ar' ? 'استكشف' : 'Explore'}</h4>{nav.slice(0, 4).map((n) => <a key={n.href} href={n.href}>{t(n.label)}</a>)}</div>
            <div><h4>{locale === 'ar' ? 'اكتشف' : 'Discover'}</h4>{nav.slice(4).map((n) => <a key={n.href} href={n.href}>{t(n.label)}</a>)}<a href="/verify">{locale === 'ar' ? 'تأكّد من شهادة' : 'Check a certificate'}</a></div>
            <div><h4>{locale === 'ar' ? 'تواصل' : 'Connect'}</h4><a href="#contact" onClick={(e) => { e.preventDefault(); setForm({ kind: 'CONTACT', page: 'footer' }) }}>{locale === 'ar' ? 'تواصل معانا' : 'Contact us'}</a><a href="#partners">{locale === 'ar' ? 'الشراكات' : 'Partnerships'}</a><a href="/admissions/apply">{locale === 'ar' ? 'التقديم أونلاين' : 'Apply online'}</a></div>
          </div>
          {(['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'] as const).some((k) => C.contact[k]) ? (
            <div className="tns-social" aria-label={locale === 'ar' ? 'تابعنا' : 'Follow us'}>
              {(['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'] as const).filter((k) => C.contact[k]).map((k) => (
                <a key={k} href={C.contact[k]} target="_blank" rel="noopener noreferrer" aria-label={k}><Icon name={k} size={20} /></a>
              ))}
            </div>
          ) : null}
          <div className="bottom">
            <span className="en">© {new Date().getFullYear()} TechNova</span>
            <span><a href="/policies">{locale === 'ar' ? 'السياسات والشروط' : 'Policies & terms'}</a></span>
          </div>
        </div>
      </footer>

      {form ? <RequestForm open={form} onClose={() => setForm(null)} solutions={C.solutions.items.filter((x) => x.show !== false).map((x) => t(x.title))} partnerKinds={C.partners.kinds.filter((x) => x.show !== false).map((x) => t(x.title))} /> : null}
      <CookieNotice />
      {wa ? <a className="tns-wa" onClick={() => track('WHATSAPP', 'float')} href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z" /></svg></a> : null}
    </div>
  )
}

export default function SiteHome({ content, items = [], stats, preview, fontClass, page = 'home', detail, banner, courses }: { content: SiteContent; items?: PublicItem[]; stats: SiteStats | null; preview: boolean; fontClass: string; page?: SitePage; detail?: SiteDetail; banner?: PublicCampaign | null; courses?: PublicCourse[] }) {
  return (
    <div className={fontClass}>
      <I18nProvider defaults={{ staff: 'ar', portal: 'ar' }}><View C={content} items={items} stats={stats} preview={preview} page={page} detail={detail} banner={banner} courses={courses} /></I18nProvider>
    </div>
  )
}
