'use client'

/** x01: manage website items of one kind (products / achievements / media) — add, edit, show / hide, feature, delete. */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { CATEGORIES, KIND_TITLE, type ItemKind } from '@/lib/site/items'

interface Item {
  id: string; kind: ItemKind; category: string; titleEn: string; titleAr: string; textEn: string | null; textAr: string | null
  metaEn: string | null; metaAr: string | null; imageUrl: string | null; videoUrl: string | null; linkUrl: string | null
  date: string | null; price: number | null; showPrice: boolean; inStock: boolean; featured: boolean; show: boolean; sortOrder: number
}
type Draft = Omit<Item, 'id' | 'date'> & { id?: string; date: string }

const empty = (kind: ItemKind): Draft => ({
  kind, category: Object.keys(CATEGORIES[kind])[0], titleEn: '', titleAr: '', textEn: '', textAr: '', metaEn: '', metaAr: '',
  imageUrl: '', videoUrl: '', linkUrl: '', date: '', price: null, showPrice: false, inStock: true, featured: false, show: true, sortOrder: 0,
})
const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'

export function ItemsManager({ kind, canEdit }: { kind: ItemKind; canEdit: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const key = ['website-items', kind]
  const { data: items = [], isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<Item[]>(`/api/website/items?kind=${kind}`) })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const cats = CATEGORIES[kind]
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const send = async (path: string, method: string, body?: object) => {
    setBusy(true)
    try {
      await fetchApi(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      await qc.invalidateQueries({ queryKey: key })
      return true
    } catch (e) {
      notify.error(e instanceof Error ? e.message : L('Could not save', 'معرفتش أحفظ'))
      return false
    } finally {
      setBusy(false)
    }
  }
  const payload = (d: Draft) => ({ ...d, id: undefined, date: d.date || null, price: d.price === null || Number.isNaN(d.price) ? null : d.price })
  const save = async () => {
    if (!draft) return
    const ok = draft.id ? await send(`/api/website/items/${draft.id}`, 'PATCH', payload(draft)) : await send('/api/website/items', 'POST', payload(draft))
    if (ok) { notify.success(L('Saved — the website shows it now', 'اتحفظ — الموقع بيعرضه دلوقتي')); setDraft(null) }
  }
  const quick = (it: Item, patch: Partial<Item>) => send(`/api/website/items/${it.id}`, 'PATCH', payload({ ...it, ...patch, date: (patch.date ?? it.date ?? '').slice(0, 10) }))

  const upload = async (f: File) => {
    try {
      const sig = await fetchApi<{ cloudName: string; apiKey: string; timestamp: number; signature: string; folder: string }>('/api/upload?folder=website')
      const form = new FormData()
      form.append('file', f); form.append('api_key', sig.apiKey); form.append('timestamp', String(sig.timestamp))
      form.append('signature', sig.signature); form.append('folder', sig.folder)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.secure_url) throw new Error(json?.error?.message || 'upload')
      set('imageUrl', json.secure_url)
    } catch {
      notify.error(L('Upload is not available here (no photo storage keys). Paste a photo link instead.', 'الرفع مش متاح هنا (مفيش مفاتيح تخزين الصور). حط لينك الصورة بدل كده.'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{L(`${KIND_TITLE[kind].en}: switched-on items show on the website; featured ones come first.`, `${KIND_TITLE[kind].ar}: اللي عليه «يظهر» بيظهر على الموقع، والمميز بييجي الأول.`)}</p>
        {canEdit && !draft ? <button type="button" className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800" onClick={() => setDraft(empty(kind))}>+ {L('Add', 'ضيف')}</button> : null}
      </div>

      {draft ? (
        <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">{L('Type', 'النوع')}
              <select className={input} value={draft.category} onChange={(e) => set('category', e.target.value)}>{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select>
            </label>
            <label className="block text-sm font-semibold text-slate-700">{L('Date (optional)', 'التاريخ (اختياري)')}
              <input type="date" dir="ltr" className={input} value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </label>
            <label className="block text-sm font-semibold text-slate-700">{L('Title — Arabic', 'العنوان — عربي')}<input className={input} dir="rtl" value={draft.titleAr} onChange={(e) => set('titleAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Title — English', 'العنوان — إنجليزي')}<input className={input} dir="ltr" value={draft.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{kind === 'PRODUCT' ? L('Under the title — Arabic (e.g. ages 8+)', 'تحت العنوان — عربي (مثلاً من سن 8)') : L('Under the title — Arabic', 'تحت العنوان — عربي')}<input className={input} dir="rtl" value={draft.metaAr ?? ''} onChange={(e) => set('metaAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Under the title — English', 'تحت العنوان — إنجليزي')}<input className={input} dir="ltr" value={draft.metaEn ?? ''} onChange={(e) => set('metaEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Text — Arabic (optional)', 'الوصف — عربي (اختياري)')}<textarea rows={3} className={input} dir="rtl" value={draft.textAr ?? ''} onChange={(e) => set('textAr', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">{L('Text — English (optional)', 'الوصف — إنجليزي (اختياري)')}<textarea rows={3} className={input} dir="ltr" value={draft.textEn ?? ''} onChange={(e) => set('textEn', e.target.value)} /></label>
            <label className="block text-sm font-semibold text-slate-700">{L('Photo link', 'لينك الصورة')}
              <input className={input} dir="ltr" placeholder="https://" value={draft.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} />
              <input type="file" accept="image/*" className="mt-1 block text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} aria-label={L('Upload a photo', 'ارفع صورة')} />
            </label>
            {kind !== 'PRODUCT' ? <label className="block text-sm font-semibold text-slate-700">{L('Video link (YouTube / mp4)', 'لينك فيديو (يوتيوب / mp4)')}<input className={input} dir="ltr" placeholder="https://" value={draft.videoUrl ?? ''} onChange={(e) => set('videoUrl', e.target.value)} /></label> : null}
            <label className="block text-sm font-semibold text-slate-700">{kind === 'MEDIA' ? L('Read-more link (optional)', 'لينك «اقرأ أكتر» (اختياري)') : L('Link (optional)', 'لينك (اختياري)')}<input className={input} dir="ltr" placeholder="https://" value={draft.linkUrl ?? ''} onChange={(e) => set('linkUrl', e.target.value)} /></label>
            {kind === 'PRODUCT' ? <>
              <label className="block text-sm font-semibold text-slate-700">{L('Price (EGP)', 'السعر (جنيه)')}<input type="number" dir="ltr" className={input} value={draft.price ?? ''} onChange={(e) => set('price', e.target.value === '' ? null : Number(e.target.value))} /></label>
              <div className="flex flex-wrap items-end gap-4 text-sm font-semibold text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.showPrice} onChange={(e) => set('showPrice', e.target.checked)} />{L('Show the price', 'السعر يظهر')}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.inStock} onChange={(e) => set('inStock', e.target.checked)} />{L('Available', 'متاح')}</label>
              </div>
            </> : null}
            <div className="flex flex-wrap items-end gap-4 text-sm font-semibold text-slate-700 sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.show} onChange={(e) => set('show', e.target.checked)} />{L('Shown on the website', 'يظهر على الموقع')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.featured} onChange={(e) => set('featured', e.target.checked)} />{L('Featured (first)', 'مميز (يظهر الأول)')}</label>
              <label className="flex items-center gap-2">{L('Order', 'الترتيب')}<input type="number" dir="ltr" className="w-20 rounded-lg border border-slate-200 px-2 py-1" value={draft.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} /></label>
            </div>
          </div>
          {draft.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.imageUrl} alt="" className="h-32 rounded-lg border border-slate-200 object-cover" />
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50" onClick={() => void save()}>{busy ? '…' : L('Save', 'احفظ')}</button>
            <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setDraft(null)}>{L('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="text-sm text-slate-500">…</p> : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{L('Nothing yet. Until you add real items, this section does not show on the website.', 'لسه مفيش. لحد ما تضيف حاجات حقيقية، القسم ده مش هيظهر على الموقع.')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <li key={it.id} className={`overflow-hidden rounded-xl border bg-white ${it.show ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60'}`}>
              {it.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.imageUrl} alt="" className="h-36 w-full object-cover" />
              ) : <div className="flex h-36 items-center justify-center bg-gradient-to-br from-sky-900 to-sky-600 text-sm text-sky-100">{L('No photo', 'مفيش صورة')}</div>}
              <div className="space-y-1 p-3">
                <p className="text-xs font-semibold text-sky-700">{ar ? cats[it.category]?.ar : cats[it.category]?.en}{it.featured ? ` · ★ ${L('featured', 'مميز')}` : ''}{it.date ? ` · ${it.date.slice(0, 10)}` : ''}</p>
                <p className="font-bold text-slate-900">{ar ? it.titleAr : it.titleEn}</p>
                {(ar ? it.metaAr : it.metaEn) ? <p className="text-xs text-slate-500">{ar ? it.metaAr : it.metaEn}</p> : null}
                {canEdit ? (
                  <div className="flex flex-wrap gap-1 pt-2">
                    <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setDraft({ ...it, date: (it.date ?? '').slice(0, 10) })}>{L('Edit', 'تعديل')}</button>
                    <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void quick(it, { show: !it.show })}>{it.show ? L('Hide', 'اخفي') : L('Show', 'اظهر')}</button>
                    <button type="button" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void quick(it, { featured: !it.featured })}>{it.featured ? L('Not featured', 'مش مميز') : L('Feature', 'مميز')}</button>
                    <button type="button" className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => { if (confirm(L('Delete this item? This cannot be undone.', 'تمسح ده؟ مش هيرجع تاني.'))) void send(`/api/website/items/${it.id}`, 'DELETE') }}>{L('Delete', 'امسح')}</button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
