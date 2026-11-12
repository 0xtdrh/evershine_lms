'use client'

/** Six phases 1-a: which tracks / courses show on the website's courses page, their page sections and contents. */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { SECTION_KEYS, SECTION_LABEL, slugFrom, type SectionKey, type Sections } from '@/lib/site/courses'

type Bi = { en: string; ar: string }
interface Listing { slug: string; show: boolean; soldAlone: boolean; sortOrder: number; titleEn: string | null; titleAr: string | null; summaryEn: string | null; summaryAr: string | null; imageUrl: string | null; introVideoUrl: string | null; sections: Sections | null }
interface Row { refType: 'TRACK' | 'COURSE'; refId: string; name: string; trackName: string | null; inTrack: boolean; listing: Listing | null }
type Draft = Omit<Listing, 'sections'> & { refType: Row['refType']; refId: string; sections: Sections; inTrack: boolean; name: string }

const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
const LISTS: SectionKey[] = ['outcomes', 'requirements']

function BiRow({ v, onChange, onRemove }: { v: Bi; onChange: (v: Bi) => void; onRemove?: () => void }) {
  return (
    <div className="flex gap-2">
      <input className={input} dir="rtl" placeholder="عربي" value={v.ar} onChange={(e) => onChange({ ...v, ar: e.target.value })} />
      <input className={input} dir="ltr" placeholder="English" value={v.en} onChange={(e) => onChange({ ...v, en: e.target.value })} />
      {onRemove ? <button type="button" className="rounded-md border border-rose-200 px-2 text-xs font-semibold text-rose-700" onClick={onRemove} aria-label={L('Remove', 'شيل')}>×</button> : null}
    </div>
  )
}

export function CoursesManager({ canEdit }: { canEdit: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['website-courses'], queryFn: () => fetchApi<{ items: Row[]; settings: { sections: Record<SectionKey, boolean> } }>('/api/website/courses') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const lab = (k: SectionKey) => (ar ? SECTION_LABEL[k].ar : SECTION_LABEL[k].en)

  const put = async (body: object, ok: string) => {
    setBusy(true)
    try {
      await fetchApi('/api/website/courses', { method: 'PUT', body: JSON.stringify(body) })
      await qc.invalidateQueries({ queryKey: ['website-courses'] })
      notify.success(ok)
      return true
    } catch (e) {
      notify.error(e instanceof Error ? e.message : L('Could not save', 'معرفتش أحفظ'))
      return false
    } finally {
      setBusy(false)
    }
  }
  const open = (r: Row) => setDraft({
    refType: r.refType, refId: r.refId, inTrack: r.inTrack, name: r.name,
    slug: r.listing?.slug ?? slugFrom(r.name), show: r.listing?.show ?? false, soldAlone: r.listing?.soldAlone ?? false, sortOrder: r.listing?.sortOrder ?? 0,
    titleEn: r.listing?.titleEn ?? '', titleAr: r.listing?.titleAr ?? '', summaryEn: r.listing?.summaryEn ?? '', summaryAr: r.listing?.summaryAr ?? '',
    imageUrl: r.listing?.imageUrl ?? '', introVideoUrl: r.listing?.introVideoUrl ?? '', sections: (r.listing?.sections ?? {}) as Sections,
  })
  const sec = <K extends SectionKey>(k: K) => ((draft?.sections?.[k] ?? {}) as NonNullable<Sections[K]> & { show?: boolean | null })
  const setSec = <K extends SectionKey>(k: K, v: Partial<NonNullable<Sections[K]>>) => setDraft((d) => (d ? { ...d, sections: { ...d.sections, [k]: { ...(d.sections[k] ?? {}), ...v } } } : d))

  if (isLoading || !data) return <p className="text-sm text-slate-500">…</p>
  const defaults = data.settings.sections

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{L('Choose what shows on the website courses page. A track is a full path; a course inside a track shows alone only when “sold alone” is on. Every section of a course page has a company default and can be changed per course.', 'اختار اللي يظهر في صفحة الكورسات على الموقع. التراك = مسار كامل، والكورس اللي جوه تراك بيظهر لوحده بس لو «يتباع لوحده» شغال. كل قسم في صفحة الكورس ليه إعداد للشركة كلها، وتقدر تغيّره لكل كورس.')}</p>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-800">{L('Company defaults for course pages', 'الإعدادات العامة لصفحات الكورسات')}</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SECTION_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" disabled={!canEdit || busy} checked={defaults[k]} onChange={(e) => void put({ settings: { sections: { ...defaults, [k]: e.target.checked } } }, L('Saved', 'اتحفظ'))} />{lab(k)}
            </label>
          ))}
        </div>
      </details>

      {draft ? (
        <div className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
          <p className="font-bold text-slate-900">{draft.name}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">{L('Link name', 'اسم اللينك')}<input className={input} dir="ltr" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /><span className="mt-1 block text-xs font-normal text-slate-500" dir="ltr">/courses/{draft.slug}</span></label>
            <div className="flex flex-wrap items-end gap-4 text-sm font-semibold text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.show} onChange={(e) => setDraft({ ...draft, show: e.target.checked })} />{L('Shown on the courses page', 'يظهر في صفحة الكورسات')}</label>
              {draft.refType === 'COURSE' && draft.inTrack ? <label className="flex items-center gap-2"><input type="checkbox" checked={draft.soldAlone} onChange={(e) => setDraft({ ...draft, soldAlone: e.target.checked })} />{L('Sold alone (outside its track)', 'يتباع لوحده (من غير التراك)')}</label> : null}
              <label className="flex items-center gap-2">{L('Order', 'الترتيب')}<input type="number" dir="ltr" className="w-20 rounded-lg border border-slate-200 px-2 py-1" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} /></label>
            </div>
            <label className="block text-sm font-semibold text-slate-700">{L('Name on the website — Arabic (empty = the system name)', 'الاسم على الموقع — عربي (فاضي = اسمه في السيستم)')}<input className={input} dir="rtl" value={draft.titleAr ?? ''} onChange={(e) => setDraft({ ...draft, titleAr: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Name — English', 'الاسم — إنجليزي')}<input className={input} dir="ltr" value={draft.titleEn ?? ''} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Short description — Arabic', 'وصف قصير — عربي')}<textarea rows={2} className={input} dir="rtl" value={draft.summaryAr ?? ''} onChange={(e) => setDraft({ ...draft, summaryAr: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Short description — English', 'وصف قصير — إنجليزي')}<textarea rows={2} className={input} dir="ltr" value={draft.summaryEn ?? ''} onChange={(e) => setDraft({ ...draft, summaryEn: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Photo link', 'لينك الصورة')}<input className={input} dir="ltr" placeholder="https://" value={draft.imageUrl ?? ''} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Intro video (YouTube / mp4)', 'فيديو تعريفي (يوتيوب / mp4)')}<input className={input} dir="ltr" placeholder="https://" value={draft.introVideoUrl ?? ''} onChange={(e) => setDraft({ ...draft, introVideoUrl: e.target.value })} /></label>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-800">{L('Page sections', 'أقسام الصفحة')}</p>
            {SECTION_KEYS.map((k) => {
              const s = sec(k)
              const val = s.show === true ? 'on' : s.show === false ? 'off' : 'default'
              return (
                <div key={k} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{lab(k)}</span>
                    <select className="rounded-md border border-slate-200 px-2 py-1 text-xs" value={val} onChange={(e) => setSec(k, { show: e.target.value === 'on' ? true : e.target.value === 'off' ? false : null } as never)} aria-label={lab(k)}>
                      <option value="default">{L(`Company default (${defaults[k] ? 'shown' : 'hidden'})`, `زي الإعداد العام (${defaults[k] ? 'ظاهر' : 'مخفي'})`)}</option>
                      <option value="on">{L('Shown', 'ظاهر')}</option>
                      <option value="off">{L('Hidden', 'مخفي')}</option>
                    </select>
                  </div>
                  {LISTS.includes(k) ? (() => {
                    const items = ((s as { items?: Bi[] }).items ?? []) as Bi[]
                    return (
                      <div className="space-y-2">
                        {items.map((it, i) => <BiRow key={i} v={it} onChange={(v) => setSec(k, { items: items.map((x, j) => (j === i ? v : x)) } as never)} onRemove={() => setSec(k, { items: items.filter((_, j) => j !== i) } as never)} />)}
                        <button type="button" className="text-xs font-semibold text-sky-700" onClick={() => setSec(k, { items: [...items, { en: '', ar: '' }] } as never)}>+ {L('Add a line', 'ضيف سطر')}</button>
                      </div>
                    )
                  })() : null}
                  {k === 'preview' ? <input className={input} dir="ltr" placeholder={L('Free lesson video link (YouTube / mp4)', 'لينك فيديو الدرس المجاني (يوتيوب / mp4)')} value={(s as { videoUrl?: string | null }).videoUrl ?? ''} onChange={(e) => setSec('preview', { videoUrl: e.target.value })} /> : null}
                  {k === 'instructor' ? (
                    <div className="space-y-2">
                      <BiRow v={(s as { name?: Bi }).name ?? { en: '', ar: '' }} onChange={(v) => setSec('instructor', { name: v })} />
                      <BiRow v={(s as { bio?: Bi }).bio ?? { en: '', ar: '' }} onChange={(v) => setSec('instructor', { bio: v })} />
                      <input className={input} dir="ltr" placeholder={L('Photo link', 'لينك الصورة')} value={(s as { photoUrl?: string | null }).photoUrl ?? ''} onChange={(e) => setSec('instructor', { photoUrl: e.target.value })} />
                    </div>
                  ) : null}
                  {k === 'faq' ? (() => {
                    const items = ((s as { items?: { q: Bi; a: Bi }[] }).items ?? [])
                    return (
                      <div className="space-y-3">
                        {items.map((it, i) => (
                          <div key={i} className="space-y-1 border-t border-slate-100 pt-2">
                            <BiRow v={it.q} onChange={(v) => setSec('faq', { items: items.map((x, j) => (j === i ? { ...x, q: v } : x)) })} onRemove={() => setSec('faq', { items: items.filter((_, j) => j !== i) })} />
                            <BiRow v={it.a} onChange={(v) => setSec('faq', { items: items.map((x, j) => (j === i ? { ...x, a: v } : x)) })} />
                          </div>
                        ))}
                        <button type="button" className="text-xs font-semibold text-sky-700" onClick={() => setSec('faq', { items: [...items, { q: { en: '', ar: '' }, a: { en: '', ar: '' } }] })}>+ {L('Add a question', 'ضيف سؤال')}</button>
                      </div>
                    )
                  })() : null}
                  {k === 'sessions' ? <p className="text-xs text-slate-500">{L('Taken from the published curriculum of the first level.', 'بتيجي من المنهج المنشور لأول مستوى.')}</p> : null}
                  {k === 'projects' ? <p className="text-xs text-slate-500">{L('Taken from Website › Achievements (student projects).', 'بتيجي من الموقع › الإنجازات (مشاريع الطلاب).')}</p> : null}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !canEdit} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50" onClick={async () => {
              const { inTrack: _i, name: _n, ...listing } = draft
              if (await put({ listing }, L('Saved — the courses page shows it now', 'اتحفظ — صفحة الكورسات بتعرضه دلوقتي'))) setDraft(null)
            }}>{busy ? '…' : L('Save', 'احفظ')}</button>
            <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setDraft(null)}>{L('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>
            <th className="px-3 py-2 text-start font-semibold">{L('Track / course', 'التراك / الكورس')}</th><th className="px-3 py-2 text-start font-semibold">{L('On the website', 'على الموقع')}</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={`${r.refType}:${r.refId}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <span className={`me-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.refType === 'TRACK' ? 'bg-indigo-50 text-indigo-800' : 'bg-sky-50 text-sky-800'}`}>{r.refType === 'TRACK' ? L('Track', 'تراك') : L('Course', 'كورس')}</span>
                  <b className="text-slate-900">{r.name}</b>{r.trackName ? <span className="text-xs text-slate-500"> · {r.trackName}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">{r.listing?.show ? <span className="font-semibold text-emerald-700" dir="ltr">/courses/{r.listing.slug}</span> : <span className="text-slate-400">{L('Not shown', 'مش ظاهر')}</span>}{r.listing?.show && r.refType === 'COURSE' && r.inTrack && !r.listing.soldAlone ? <span className="ms-1 text-amber-700">({L('inside its track only', 'جوه التراك بس')})</span> : null}</td>
                <td className="px-3 py-2 text-end">{canEdit ? <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => open(r)}>{r.listing ? L('Edit', 'تعديل') : L('Set up', 'جهّزه')}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
