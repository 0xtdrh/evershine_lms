'use client'

/**
 * x01 "Website" screen: edit every text of the public website in Arabic and English, switch any section or item on/off,
 * add / remove / reorder items, contact details and numbers. Saved in AppSetting `website.content` (GET/PUT
 * /api/website/content). Website requests (forms) are on /dashboard/leads. RBAC website:read / website:update.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import type { SiteContent } from '@/lib/site/content'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
type Obj = { [k: string]: Json }

const SECTIONS: { key: keyof SiteContent; en: string; ar: string }[] = [
  { key: 'contact', en: 'Contact details', ar: 'بيانات التواصل' },
  { key: 'fields', en: 'Field tiles', ar: 'مربعات المجالات' },
  { key: 'hero', en: 'Top of the page', ar: 'الواجهة' },
  { key: 'audience', en: 'Who are you? cards', ar: 'كروت «إنت جاي علشان»' },
  { key: 'stats', en: 'Numbers', ar: 'الأرقام' },
  { key: 'about', en: 'Who we are', ar: 'مين إحنا' },
  { key: 'divisions', en: 'Divisions', ar: 'الأقسام' },
  { key: 'education', en: 'Education', ar: 'التعليم' },
  { key: 'curriculum', en: 'Curriculum', ar: 'المنهج' },
  { key: 'solutions', en: 'Solutions', ar: 'الحلول' },
  { key: 'why', en: 'Why TechNova', ar: 'ليه TechNova' },
  { key: 'achievements', en: 'Achievements & projects', ar: 'الإنجازات والمشاريع' },
  { key: 'verify', en: 'Certificate check', ar: 'التأكد من الشهادة' },
  { key: 'products', en: 'Products', ar: 'المنتجات' },
  { key: 'partners', en: 'Partnerships', ar: 'الشراكات' },
  { key: 'events', en: 'Events', ar: 'الفعاليات' },
  { key: 'media', en: 'Media & news', ar: 'الميديا والأخبار' },
  { key: 'cta', en: 'Last call', ar: 'الدعوة الأخيرة' },
  { key: 'nav', en: 'Menu', ar: 'القائمة' },
]

const FIELD: Record<string, [string, string]> = {
  title: ['Title', 'العنوان'], text: ['Text', 'الكلام'], label: ['Label', 'الاسم'], kicker: ['Small line', 'السطر الصغير'],
  title1: ['Title — line 1', 'العنوان — السطر الأول'], title2: ['Title — line 2', 'العنوان — السطر التاني'], tagline: ['Tagline', 'الجملة الإنجليزي'],
  videoUrl: ['Video link (mp4)', 'لينك الفيديو (mp4)'], primary: ['Main button', 'الزرار الأساسي'], secondary: ['Second button', 'الزرار التاني'],
  cta: ['Button', 'الزرار'], href: ['Link', 'اللينك'], tag: ['Tag', 'الشارة'], meta: ['Under the title', 'تحت العنوان'], type: ['Type', 'النوع'],
  name: ['Name', 'الاسم'], ages: ['Ages', 'السن'], note: ['Small note', 'ملحوظة صغيرة'], step: ['Step (English)', 'الخطوة (إنجليزي)'],
  facebook: ['Facebook page link', 'لينك صفحة فيسبوك'], instagram: ['Instagram link', 'لينك إنستجرام'], tiktok: ['TikTok link', 'لينك تيك توك'], youtube: ['YouTube link', 'لينك يوتيوب'], linkedin: ['LinkedIn link', 'لينك لينكدإن'], fields: ['Field tiles', 'مربعات المجالات'],
  whatsapp: ['WhatsApp number', 'رقم الواتساب'], phone: ['Phone', 'التليفون'], email: ['Email', 'الإيميل'], address: ['Address', 'العنوان'], mapUrl: ['Map link', 'لينك الخريطة'],
  items: ['Items', 'العناصر'], points: ['Points', 'النقط'], programmes: ['Programmes', 'البرامج'], journey: ['Student journey', 'رحلة الطالب'], kinds: ['Partnership types', 'أنواع الشراكة'],
  places: ['Partner places shown', 'الأماكن الشريكة اللي تظهر'], steps: ['Steps', 'الخطوات'], families: ['Families card (B2C)', 'كارت العائلات'], schools: ['Schools card (B2B)', 'كارت المدارس'],
  stats: ['Numbers', 'الأرقام'], audience: ['Cards', 'الكروت'], nav: ['Menu items', 'بنود القائمة'], contact: ['Contact details', 'بيانات التواصل'],
  icon: ['Icon', 'الأيقونة'], kind: ['Kind', 'النوع'], value: ['Fixed number', 'رقم ثابت'], min: ['Show only from', 'يظهر من أول'], plus: ['Add “+”', 'يضيف «+»'], source: ['Counted from', 'بيتحسب من'],
}
const SOURCES: [string, string, string][] = [['', 'Fixed number', 'رقم ثابت'], ['students', 'Students who learned', 'الطلاب اللي اتعلموا'], ['sessions', 'Sessions delivered', 'الحصص اللي اتعملت'], ['certificates', 'Certificates', 'الشهادات'], ['partnerPlaces', 'Partner places', 'الأماكن الشريكة'], ['branches', 'Branches', 'الفروع']]
const ICONS = ['robot', 'bolt', 'phone', 'cap', 'home', 'hotel', 'chip', 'flask', 'wave', 'code', 'screen', 'check', 'layers', 'grow', 'eye', 'trophy', 'tools', 'route', 'shield', 'building']

const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isBi = (v: Json): v is { en: string; ar: string } => isObj(v) && typeof v.en === 'string' && typeof v.ar === 'string' && Object.keys(v).every((k) => k === 'en' || k === 'ar' || k === 'step')
const lab = (k: string) => (FIELD[k] ? L(FIELD[k][0], FIELD[k][1]) : k)
/** every number gets all its fields, so "counted from" can be switched to a fixed number and back */
const withStatFields = (c: Obj): Obj => ({
  ...c,
  stats: Array.isArray(c.stats) ? c.stats.map((x) => (isObj(x) ? { label: x.label, source: x.source ?? null, value: x.value ?? null, min: x.min ?? null, plus: x.plus ?? false, show: x.show ?? true } : x)) : c.stats,
})
const blank = (v: Json): Json => (typeof v === 'string' ? '' : Array.isArray(v) ? [] : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'sample').map(([k, x]) => [k, k === 'show' ? true : blank(x)])) : v)

function BiInput({ value, onChange, long }: { value: { en: string; ar: string }; onChange: (v: { en: string; ar: string }) => void; long?: boolean }) {
  const cls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(['ar', 'en'] as const).map((l) => (
        <label key={l} className="block text-xs text-slate-500">
          {l === 'ar' ? 'عربي' : 'English'}
          {long ? <textarea dir={l === 'ar' ? 'rtl' : 'ltr'} rows={3} className={cls} value={value[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
            : <input dir={l === 'ar' ? 'rtl' : 'ltr'} className={cls} value={value[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />}
        </label>
      ))}
    </div>
  )
}

function Node({ k, v, onChange, depth }: { k: string; v: Json; onChange: (v: Json) => void; depth: number }) {
  const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
  if (k === 'sample') return null
  if (isBi(v)) {
    const long = Math.max(v.en.length, v.ar.length) > 70
    return <div className="space-y-1"><p className="text-sm font-semibold text-slate-700">{lab(k)}</p><BiInput value={v} long={long} onChange={(x) => onChange({ ...v, ...x })} /></div>
  }
  if (k === 'show') return null // drawn as the on/off switch of its box
  if (k === 'source') return (
    <label className="block text-sm font-semibold text-slate-700">{lab(k)}
      <select className={input} value={String(v ?? '')} onChange={(e) => onChange(e.target.value || null)}>{SOURCES.map(([s, en, ar]) => <option key={s} value={s}>{L(en, ar)}</option>)}</select>
    </label>
  )
  if (k === 'icon') return (
    <label className="block text-sm font-semibold text-slate-700">{lab(k)}
      <select className={input} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>{ICONS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
    </label>
  )
  if (typeof v === 'boolean') return <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} />{lab(k)}</label>
  if (typeof v === 'number' || (v === null && (k === 'value' || k === 'min'))) return (
    <label className="block text-sm font-semibold text-slate-700">{lab(k)}
      <input type="number" dir="ltr" className={input} value={typeof v === 'number' ? v : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    </label>
  )
  if (typeof v === 'string') return (
    <label className="block text-sm font-semibold text-slate-700">{lab(k)}
      <input dir={/url|href|whatsapp|phone|email|kicker|tagline|step|name|facebook|instagram|tiktok|youtube|linkedin/i.test(k) ? 'ltr' : 'auto'} className={input} value={v} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
  if (Array.isArray(v)) return <List k={k} items={v} onChange={onChange} depth={depth} />
  if (isObj(v)) return <Box k={k} v={v} onChange={onChange} depth={depth} />
  return null
}

function Box({ k, v, onChange, depth, title }: { k: string; v: Obj; onChange: (v: Json) => void; depth: number; title?: string }) {
  const hidden = v.show === false
  return (
    <div className={`space-y-3 rounded-xl border p-3 ${hidden ? 'border-dashed border-slate-300 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">{title ?? lab(k)}{v.sample ? <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{L('example — never on the real site', 'مثال — مش هيظهر في الموقع الحقيقي')}</span> : null}</p>
        {k === 'contact' ? null : (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={!hidden} onChange={(e) => onChange({ ...v, show: e.target.checked })} />{L('Shown on the website', 'يظهر على الموقع')}
          </label>
        )}
      </div>
      {!hidden || depth === 0 ? Object.entries(v).map(([ck, cv]) => <Node key={ck} k={ck} v={cv} depth={depth + 1} onChange={(x) => onChange({ ...v, [ck]: x })} />) : null}
    </div>
  )
}

function List({ k, items, onChange, depth }: { k: string; items: Json[]; onChange: (v: Json) => void; depth: number }) {
  const move = (i: number, d: number) => { const a = [...items]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a) }
  const btn = 'rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30'
  const titleOf = (x: Json, i: number) => (isObj(x) && isBi(x.title as Json) ? `${i + 1}. ${(x.title as { ar: string }).ar}` : isObj(x) && isBi(x.label as Json) ? `${i + 1}. ${(x.label as { ar: string }).ar}` : isObj(x) && typeof x.name === 'string' ? `${i + 1}. ${x.name}` : `${i + 1}`)
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-700">{lab(k)} <span className="text-xs font-normal text-slate-400">({items.length})</span></p>
      {items.map((x, i) => (
        <div key={i} className="space-y-1">
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" className={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={L('Up', 'لفوق')}>↑</button>
            <button type="button" className={btn} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={L('Down', 'لتحت')}>↓</button>
            <button type="button" className={`${btn} text-rose-600`} onClick={() => { if (confirm(L('Remove this item?', 'تشيل العنصر ده؟'))) onChange(items.filter((_, j) => j !== i)) }}>{L('Remove', 'شيل')}</button>
          </div>
          {isObj(x) && !isBi(x) ? <Box k={k} v={x} title={titleOf(x, i)} depth={depth + 1} onChange={(nv) => onChange(items.map((y, j) => (j === i ? nv : y)))} />
            : <Node k={k} v={x} depth={depth + 1} onChange={(nv) => onChange(items.map((y, j) => (j === i ? nv : y)))} />}
        </div>
      ))}
      <button type="button" className="rounded-lg border border-dashed border-sky-400 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50" onClick={() => onChange([...items, items.length ? blank(items[items.length - 1]) : { en: '', ar: '' }])}>+ {L('Add', 'ضيف')}</button>
    </div>
  )
}

export default function WebsitePage() {
  useI18n()
  const { can } = useMyPermissions()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['website-content'], queryFn: () => fetchApi<{ content: SiteContent; defaults: SiteContent }>('/api/website/content') })
  const [draft, setDraft] = useState<Obj | null>(null)
  const [section, setSection] = useState<keyof SiteContent>('contact')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data && !draft) setDraft(withStatFields(data.content as unknown as Obj)) }, [data, draft])
  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(withStatFields(data.content as unknown as Obj)), [data, draft])
  const canEdit = can('website', 'update')

  const save = async (body: object, ok: string) => {
    setSaving(true)
    try {
      const r = await fetchApi<{ content: SiteContent }>('/api/website/content', { method: 'PUT', body: JSON.stringify(body) })
      qc.setQueryData(['website-content'], { content: r.content, defaults: data?.defaults })
      setDraft(withStatFields(r.content as unknown as Obj))
      notify.success(ok)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : L('Could not save', 'معرفتش أحفظ'))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !draft) return <p className="p-6 text-sm text-slate-500">…</p>
  const cur = SECTIONS.find((s) => s.key === section)!
  const value = draft[section] as Json

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{L('Website', 'الموقع')}</h1>
          <p className="text-sm text-slate-500">{L('Every text in Arabic and English, what shows and what hides, contact details and numbers. Forms sent from the website are in Website requests.', 'كل كلام الموقع بالعربي والإنجليزي، اللي يظهر واللي يستخبى، بيانات التواصل والأرقام. الفورمات اللي بتتبعت من الموقع في «طلبات الموقع».')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/leads" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{L('Website requests', 'طلبات الموقع')}</Link>
          <a href="/new-home" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{L('Open the website', 'افتح الموقع')}</a>
          {canEdit ? <>
            <button type="button" disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50" onClick={() => { if (confirm(L('Go back to the original texts? Everything you changed is lost.', 'ترجع للكلام الأصلي؟ كل اللي غيّرته هيضيع.'))) void save({ reset: true }, L('Back to the original texts', 'رجع للكلام الأصلي')) }}>{L('Original texts', 'الكلام الأصلي')}</button>
            <button type="button" disabled={!dirty || saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-40" onClick={() => void save({ content: draft }, L('Saved — the website shows it now', 'اتحفظ — الموقع بيعرضه دلوقتي'))}>{saving ? '…' : L('Save', 'احفظ')}</button>
          </> : null}
        </div>
      </div>
      {dirty ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{L('You have changes that are not saved yet.', 'عندك تغييرات لسه ما اتحفظتش.')}</p> : null}
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible" aria-label={L('Sections', 'الأقسام')}>
          {SECTIONS.map((s) => {
            const v = draft[s.key] as Json
            const off = isObj(v) && v.show === false
            return (
              <button key={s.key} type="button" onClick={() => setSection(s.key)} className={`shrink-0 rounded-lg px-3 py-2 text-start text-sm font-semibold ${section === s.key ? 'bg-sky-700 text-white' : 'text-slate-600 hover:bg-slate-100'} ${off ? 'line-through opacity-60' : ''}`}>
                {L(s.en, s.ar)}
              </button>
            )
          })}
        </nav>
        <fieldset disabled={!canEdit} className="min-w-0 flex-1 space-y-3">
          {section === 'contact' ? <p className="text-xs text-slate-500">{L('WhatsApp: with country code or 01… (the website adds Egypt’s code). Empty = the button does not show.', 'الواتساب: بكود الدولة أو 01… (الموقع بيزوّد كود مصر). فاضي = الزرار مش هيظهر.')}</p> : null}
          {section === 'stats' ? <p className="text-xs text-slate-500">{L('A counted number shows only when it reaches “Show only from”. A fixed number always shows. The home page shows the first 4 that qualify.', 'الرقم اللي بيتحسب بيظهر بس لما يوصل لـ «يظهر من أول». الرقم الثابت بيظهر دايماً. الصفحة بتعرض أول 4 أرقام تنفع.')}</p> : null}
          {Array.isArray(value) ? <List k={cur.key} items={value} depth={0} onChange={(x) => setDraft({ ...draft, [section]: x })} />
            : isObj(value) ? <Box k={cur.key} v={value} title={L(cur.en, cur.ar)} depth={0} onChange={(x) => setDraft({ ...draft, [section]: x })} /> : null}
        </fieldset>
      </div>
    </div>
  )
}
