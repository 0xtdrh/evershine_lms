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

function Circuit() {
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
    </svg>
  )
}

function Sample({ on }: { on?: boolean }) {
  const { locale } = useI18n()
  return on ? <span className="tns-sample">{locale === 'ar' ? 'مثال' : 'Example'}</span> : null
}

function View({ C, stats, preview }: { C: SiteContent; stats: SiteStats | null; preview: boolean }) {
  const { locale, setLocale } = useI18n()
  const t = (x: Bi) => (locale === 'ar' ? x.ar : x.en)
  const arr = locale === 'ar' ? '←' : '→'
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [menu, setMenu] = useState(false)
  const [cert, setCert] = useState('')
  const [form, setForm] = useState<FormOpen | null>(null)
  const router = useRouter()
  useEffect(() => setMounted(true), [])
  useReveal()

  const nav = visible(C.nav, preview)
  const numbers = shownStats(C.stats, stats)
  const achievements = visible(C.achievements.items, preview)
  const products = visible(C.products.items, preview)
  const media = visible(C.media.items, preview)
  const events = visible(C.events.items, preview)
  const waDigits = C.contact.whatsapp.replace(/\D/g, '').replace(/^00/, '')
  const wa = waDigits ? `https://wa.me/${waDigits.startsWith('0') ? `2${waDigits}` : waDigits}` : ''
  const dark = mounted && resolvedTheme === 'dark'

  const cards = (items: Card[], d = false) => items.filter((c) => c.show !== false).map((c, i) => (
    <div key={i} className={`tns-card tns-reveal${d ? ' d' : ''}`}>
      {c.icon ? <span className="tns-ico"><Icon name={c.icon} /></span> : null}
      <h3>{t(c.title)}</h3>
      <p>{t(c.text)}</p>
      {c.href ? <a className="more flip" href={c.href}>{locale === 'ar' ? 'ادخل القسم' : 'Explore'} {arr}</a> : null}
    </div>
  ))
  const mediaCards = (items: MediaCard[], label?: (m: MediaCard) => string, order?: boolean) => items.map((m, i) => (
    <div key={i} className="tns-card tns-reveal" style={{ padding: 14 }}>
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

      {/* 01 header */}
      <header className="tns-head">
        <div className="tns-wrap row">
          <a href="#top" className="tns-logo" aria-label="TechNova">
            <span className="tns-mark">TN</span>
            <span className="tns-word">Tech<b>Nova</b></span>
          </a>
          <nav className="tns-nav" aria-label={locale === 'ar' ? 'القائمة الرئيسية' : 'Main menu'}>
            {nav.map((n) => <a key={n.href} href={n.href}>{t(n.label)}</a>)}
          </nav>
          <div className="tns-tools">
            <button type="button" className="tns-icon-btn en" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} aria-label={locale === 'ar' ? 'English' : 'العربية'}>{locale === 'ar' ? 'EN' : 'ع'}</button>
            <button type="button" className="tns-icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={locale === 'ar' ? 'فاتح / غامق' : 'Light / dark'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{dark ? <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /> : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}</svg>
            </button>
            <a href="/login" className="tns-btn ghost sm hide-sm">{locale === 'ar' ? 'دخول' : 'Sign in'}</a>
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
            <button type="button" className="tns-btn primary sm" style={{ flex: 1 }} onClick={() => { setMenu(false); setForm({ kind: 'CONTACT', page: 'menu' }) }}>{locale === 'ar' ? 'تواصل معانا' : 'Contact us'}</button>
          </div>
        </div>
      </header>

      {/* 02 hero + audience */}
      {C.hero.show !== false ? (
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
                <a key={i} href={a.href}>
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

      {/* 03 numbers */}
      {numbers.length ? (
        <section style={{ background: 'var(--surface)', borderBlock: '1px solid var(--line)' }}>
          <div className="tns-wrap tns-stats">
            {numbers.slice(0, 4).map(({ i, value }) => (
              <div key={i}><div className="v"><CountUp value={value} plus={C.stats[i].plus} /></div><div className="l">{t(C.stats[i].label)}</div></div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 04 about */}
      {C.about.show !== false ? (
        <section id="about" className="tns-sec">
          <div className="tns-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'center' }}>
            <div className="tns-reveal" style={{ flex: '1 1 440px', minWidth: 0 }}>
              <p className="tns-kick">Who we are · {locale === 'ar' ? 'مين إحنا' : 'TechNova'}</p>
              <h2 className="tns-h2">{t(C.about.title)}</h2>
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
      {C.divisions.show !== false ? (
        <section id="divisions" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Our divisions</p>
            <h2 className="tns-h2">{t(C.divisions.title)}</h2>
            <div className="tns-grid" style={{ ['--min' as string]: '240px' }}>{cards(C.divisions.items)}</div>
          </div>
        </section>
      ) : null}

      {/* 06 education: families (B2C) + schools (B2B) + journey */}
      {C.education.show !== false ? (
        <section id="education" className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Education</p>
            <h2 className="tns-h2">{t(C.education.title)}</h2>
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
      {C.curriculum.show !== false ? (
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
      {C.solutions.show !== false ? (
        <section id="solutions" className="tns-sec dark tns-reveal">
          <Circuit />
          <div className="tns-wrap" style={{ position: 'relative' }}>
            <p className="tns-kick">Our solutions</p>
            <h2 className="tns-h2">{t(C.solutions.title)}</h2>
            <p className="tns-lead">{t(C.solutions.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '260px' }}>{cards(C.solutions.items, true)}</div>
            <div style={{ marginTop: 30 }}><button type="button" className="tns-btn primary" onClick={() => setForm({ kind: 'SOLUTION', page: 'solutions' })}>{t(C.solutions.cta)}</button></div>
          </div>
        </section>
      ) : null}

      {/* 09 why */}
      {C.why.show !== false ? (
        <section className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Why TechNova</p>
            <h2 className="tns-h2">{t(C.why.title)}</h2>
            <div className="tns-grid" style={{ ['--min' as string]: '300px' }}>{cards(C.why.items)}</div>
          </div>
        </section>
      ) : null}

      {/* 10 achievements & projects */}
      {C.achievements.show !== false && achievements.length ? (
        <section id="achievements" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Ideas in action</p>
            <h2 className="tns-h2">{t(C.achievements.title)}</h2>
            <p className="tns-lead">{t(C.achievements.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{mediaCards(achievements)}</div>
          </div>
        </section>
      ) : null}

      {/* 11 certificate check */}
      {C.verify.show !== false ? (
        <section id="verify" className="tns-sec" style={{ paddingBlock: 64 }}>
          <div className="tns-wrap">
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
      {C.products.show !== false && products.length ? (
        <section id="products" className="tns-sec alt">
          <div className="tns-wrap">
            <p className="tns-kick">Products</p>
            <h2 className="tns-h2">{t(C.products.title)}</h2>
            <p className="tns-lead">{t(C.products.text)}</p>
            <div className="tns-grid" style={{ ['--min' as string]: '240px' }}>{mediaCards(products, (m) => t((m as MediaCard & { type: Bi }).type), true)}</div>
          </div>
        </section>
      ) : null}

      {/* 13 partnerships */}
      {C.partners.show !== false ? (
        <section id="partners" className="tns-sec">
          <div className="tns-wrap">
            <p className="tns-kick">Partnerships</p>
            <h2 className="tns-h2">{t(C.partners.title)}</h2>
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
      {(C.events.show !== false && events.length) || (C.media.show !== false && media.length) ? (
        <section id="media" className="tns-sec alt">
          <div className="tns-wrap">
            {C.events.show !== false && events.length ? (
              <div style={{ marginBottom: 48 }}>
                <p className="tns-kick">Events</p>
                <h2 className="tns-h2">{t(C.events.title)}</h2>
                <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{mediaCards(events)}</div>
              </div>
            ) : null}
            {C.media.show !== false && media.length ? (
              <>
                <p className="tns-kick">Media & news</p>
                <h2 className="tns-h2">{t(C.media.title)}</h2>
                <div className="tns-grid" style={{ ['--min' as string]: '280px' }}>{mediaCards(media, (m) => t(m.meta))}</div>
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
                {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="tns-btn ghost" style={{ borderColor: '#5d8bb0', color: '#fff' }}>{locale === 'ar' ? 'كلّمنا واتساب' : 'WhatsApp us'}</a> : null}
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
            <div><h4>{locale === 'ar' ? 'اكتشف' : 'Discover'}</h4>{nav.slice(4).map((n) => <a key={n.href} href={n.href}>{t(n.label)}</a>)}<a href="#verify">{locale === 'ar' ? 'تأكّد من شهادة' : 'Check a certificate'}</a></div>
            <div><h4>{locale === 'ar' ? 'تواصل' : 'Connect'}</h4><a href="#contact" onClick={(e) => { e.preventDefault(); setForm({ kind: 'CONTACT', page: 'footer' }) }}>{locale === 'ar' ? 'تواصل معانا' : 'Contact us'}</a><a href="#partners">{locale === 'ar' ? 'الشراكات' : 'Partnerships'}</a><a href="/admissions/apply">{locale === 'ar' ? 'التقديم أونلاين' : 'Apply online'}</a></div>
          </div>
          <div className="bottom">
            <span className="en">© {new Date().getFullYear()} TechNova</span>
            <span><a href="/policies">{locale === 'ar' ? 'السياسات والشروط' : 'Policies & terms'}</a></span>
          </div>
        </div>
      </footer>

      {form ? <RequestForm open={form} onClose={() => setForm(null)} solutions={C.solutions.items.filter((x) => x.show !== false).map((x) => t(x.title))} partnerKinds={C.partners.kinds.filter((x) => x.show !== false).map((x) => t(x.title))} /> : null}
      {wa ? <a className="tns-wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z" /></svg></a> : null}
    </div>
  )
}

export default function SiteHome({ content, stats, preview, fontClass }: { content: SiteContent; stats: SiteStats | null; preview: boolean; fontClass: string }) {
  return (
    <div className={fontClass}>
      <I18nProvider defaults={{ staff: 'ar', portal: 'ar' }}><View C={content} stats={stats} preview={preview} /></I18nProvider>
    </div>
  )
}
