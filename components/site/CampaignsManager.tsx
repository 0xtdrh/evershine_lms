'use client'

/** x01: campaign pages in the Website screen — add / edit, link to copy, state, visits and requests, banner. */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { STATE_LABEL, type CampaignState } from '@/lib/site/campaigns'
import { KIND_LABEL, REQUEST_KINDS } from '@/lib/site/request-rules'

interface Campaign {
  id: string; slug: string; titleEn: string; titleAr: string; textEn: string | null; textAr: string | null; offerEn: string | null; offerAr: string | null
  imageUrl: string | null; videoUrl: string | null; formKind: string; startsAt: string | null; endsAt: string | null
  banner: boolean; bannerEn: string | null; bannerAr: string | null; show: boolean; state: CampaignState; visits: number; requests: number
}
type Draft = Omit<Campaign, 'id' | 'state' | 'visits' | 'requests' | 'startsAt' | 'endsAt'> & { id?: string; startsAt: string; endsAt: string }

const empty = (): Draft => ({ slug: '', titleEn: '', titleAr: '', textEn: '', textAr: '', offerEn: '', offerAr: '', imageUrl: '', videoUrl: '', formKind: 'CONTACT', startsAt: '', endsAt: '', banner: false, bannerEn: '', bannerAr: '', show: true })
const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
const STATE_CLS: Record<CampaignState, string> = { LIVE: 'bg-emerald-50 text-emerald-800', UPCOMING: 'bg-sky-50 text-sky-800', ENDED: 'bg-slate-100 text-slate-600', HIDDEN: 'bg-amber-50 text-amber-800' }

export function CampaignsManager({ canEdit }: { canEdit: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['website-campaigns'], queryFn: () => fetchApi<Campaign[]>('/api/website/campaigns') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const link = (slug: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/c/${slug}`

  const send = async (path: string, method: string, body?: object) => {
    setBusy(true)
    try {
      await fetchApi(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await qc.invalidateQueries({ queryKey: ['website-campaigns'] })
      return true
    } catch (e) {
      notify.error(e instanceof Error ? e.message : L('Could not save', 'معرفتش أحفظ'))
      return false
    } finally {
      setBusy(false)
    }
  }
  const body = (d: Draft) => ({ ...d, id: undefined, startsAt: d.startsAt || null, endsAt: d.endsAt || null })
  const save = async () => {
    if (!draft) return
    const ok = draft.id ? await send(`/api/website/campaigns/${draft.id}`, 'PATCH', body(draft)) : await send('/api/website/campaigns', 'POST', body(draft))
    if (ok) { notify.success(L('Saved', 'اتحفظ')); setDraft(null) }
  }
  const copy = async (slug: string) => {
    try { await navigator.clipboard.writeText(link(slug)); notify.success(L('Link copied', 'اللينك اتنسخ')) } catch { notify.error(link(slug)) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{L('A page for one ad or offer, with its own link (for ads, WhatsApp, a QR on a flyer). It opens on its start day and closes by itself after its end day; the old link then goes to the home page.', 'صفحة لإعلان أو عرض واحد بلينك خاص (للإعلانات والواتساب والـ QR على الفلاير). بتفتح يوم البداية وبتقفل لوحدها بعد يوم النهاية، واللينك القديم بيودّي للرئيسية.')}</p>
        {canEdit && !draft ? <button type="button" className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800" onClick={() => setDraft(empty())}>+ {L('New campaign', 'حملة جديدة')}</button> : null}
      </div>

      {draft ? (
        <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">{L('Link name (English letters, e.g. winter-camp)', 'اسم اللينك (حروف إنجليزي، مثلاً winter-camp)')}
              <input className={input} dir="ltr" value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
              {draft.slug ? <span className="mt-1 block text-xs font-normal text-slate-500" dir="ltr">{link(draft.slug)}</span> : null}
            </label>
            <label className="block text-sm font-semibold text-slate-700">{L('The button opens', 'الزرار بيفتح')}
              <select className={input} value={draft.formKind} onChange={(e) => set('formKind', e.target.value)}>{REQUEST_KINDS.map((k) => <option key={k} value={k}>{ar ? KIND_LABEL[k].ar : KIND_LABEL[k].en}</option>)}</select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">{L('Title — Arabic', 'العنوان — عربي')}<input className={input} dir="rtl" value={draft.titleAr} onChange={(e) => set('titleAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Title — English', 'العنوان — إنجليزي')}<input className={input} dir="ltr" value={draft.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Offer line — Arabic (price, place…)', 'سطر العرض — عربي (السعر، المكان…)')}<input className={input} dir="rtl" value={draft.offerAr ?? ''} onChange={(e) => set('offerAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Offer line — English', 'سطر العرض — إنجليزي')}<input className={input} dir="ltr" value={draft.offerEn ?? ''} onChange={(e) => set('offerEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Text — Arabic', 'التفاصيل — عربي')}<textarea rows={4} className={input} dir="rtl" value={draft.textAr ?? ''} onChange={(e) => set('textAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Text — English', 'التفاصيل — إنجليزي')}<textarea rows={4} className={input} dir="ltr" value={draft.textEn ?? ''} onChange={(e) => set('textEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Photo link', 'لينك الصورة')}<input className={input} dir="ltr" placeholder="https://" value={draft.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Video link (YouTube / mp4)', 'لينك فيديو (يوتيوب / mp4)')}<input className={input} dir="ltr" placeholder="https://" value={draft.videoUrl ?? ''} onChange={(e) => set('videoUrl', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Starts (optional)', 'تبدأ (اختياري)')}<input type="date" dir="ltr" className={input} value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Ends (optional)', 'تخلص (اختياري)')}<input type="date" dir="ltr" className={input} value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></label>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={draft.banner} onChange={(e) => set('banner', e.target.checked)} />{L('Show a banner on top of the website while it is live', 'شريط إعلان فوق الموقع وهي شغالة')}</label>
              {draft.banner ? <div className="grid gap-3 sm:grid-cols-2">
                <input className={input} dir="rtl" placeholder={L('Banner text — Arabic (empty = the title)', 'كلام الشريط — عربي (فاضي = العنوان)')} value={draft.bannerAr ?? ''} onChange={(e) => set('bannerAr', e.target.value)} />
                <input className={input} dir="ltr" placeholder={L('Banner text — English', 'كلام الشريط — إنجليزي')} value={draft.bannerEn ?? ''} onChange={(e) => set('bannerEn', e.target.value)} />
              </div> : null}
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={draft.show} onChange={(e) => set('show', e.target.checked)} />{L('Published', 'منشورة')}</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50" onClick={() => void save()}>{busy ? '…' : L('Save', 'احفظ')}</button>
            <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setDraft(null)}>{L('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="text-sm text-slate-500">…</p> : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{L('No campaigns yet.', 'لسه مفيش حملات.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-start font-semibold">{L('Campaign', 'الحملة')}</th><th className="px-3 py-2 text-start font-semibold">{L('State', 'الحالة')}</th>
              <th className="px-3 py-2 text-end font-semibold">{L('Visits', 'زيارات')}</th><th className="px-3 py-2 text-end font-semibold">{L('Requests', 'طلبات')}</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2"><p className="font-semibold text-slate-900">{ar ? c.titleAr : c.titleEn}</p><p className="text-xs text-slate-500" dir="ltr" style={{ textAlign: 'start' }}>/c/{c.slug}{c.startsAt || c.endsAt ? ` · ${c.startsAt ?? '…'} → ${c.endsAt ?? '…'}` : ''}{c.banner ? ` · ${L('banner', 'شريط')}` : ''}</p></td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CLS[c.state]}`}>{ar ? STATE_LABEL[c.state].ar : STATE_LABEL[c.state].en}</span></td>
                  <td className="px-3 py-2 text-end">{c.visits}</td>
                  <td className="px-3 py-2 text-end">{c.requests}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void copy(c.slug)}>{L('Copy link', 'انسخ اللينك')}</button>
                      <a className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer">{L('Open', 'افتح')}</a>
                      {canEdit ? <>
                        <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setDraft({ ...c, startsAt: c.startsAt ?? '', endsAt: c.endsAt ?? '' })}>{L('Edit', 'تعديل')}</button>
                        <button type="button" className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => { if (confirm(L('Delete this campaign? Its link stops working.', 'تمسح الحملة دي؟ اللينك بتاعها هيبطّل يشتغل.'))) void send(`/api/website/campaigns/${c.id}`, 'DELETE') }}>{L('Delete', 'امسح')}</button>
                      </> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
