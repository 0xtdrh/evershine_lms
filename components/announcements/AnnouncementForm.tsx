'use client'

/**
 * 5-D: send a targeted announcement — who (parents / students / instructors / staff) × where (company, branches,
 * partners, tracks, courses, levels, groups, chosen students), English + Arabic, attachment, pin, "I read it",
 * publish now or later. Shows how many people it will reach before sending.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { AUDIENCE_LABEL, AUDIENCES, SCOPE_LABEL, STAFF_SCOPES, type Audience, type ScopeType } from '@/lib/announcements/rules'
import { Loader2, Paperclip, Send, Users, X } from 'lucide-react'
import { DateInput, DateTimeInput } from '@/components/ui/date-input'

interface Item { id: string; name: string }
interface Options {
  allPlaces: boolean; teacher: boolean; canApprove: boolean
  settings: { teachersCanSend: boolean; defaultRequireAck: boolean }
  campuses: Item[]; partners: Item[]; tracks: Item[]; courses: Item[]; levels: Item[]; groups: Item[]
}
interface Sig { timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats?: string }

const ITEMS_OF: Partial<Record<ScopeType, keyof Options>> = { CAMPUS: 'campuses', PARTNER: 'partners', TRACK: 'tracks', COURSE: 'courses', LEVEL: 'levels', GROUP: 'groups' }

export function AnnouncementForm({ onSent }: { onSent: () => void }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data: opt } = useQuery({ queryKey: ['announcement-options'], queryFn: () => fetchApi<Options>('/api/announcements/options') })
  const [audiences, setAudiences] = useState<Audience[]>(['PARENT'])
  const [scopeType, setScopeType] = useState<ScopeType>('GROUP')
  const [ids, setIds] = useState<string[]>([])
  const [picked, setPicked] = useState<Item[]>([]) // chosen students (names)
  const [find, setFind] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleAr, setTitleAr] = useState('')
  const [contentAr, setContentAr] = useState('')
  const [pinned, setPinned] = useState(false)
  const [requireAck, setRequireAck] = useState<boolean | null>(null)
  const [publishAt, setPublishAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [file, setFile] = useState<{ url: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const ack = requireAck ?? opt?.settings.defaultRequireAck ?? false

  useEffect(() => { if (opt && !opt.allPlaces && scopeType === 'COMPANY') setScopeType('CAMPUS') }, [opt, scopeType])
  const scopes = useMemo(() => {
    if (!opt) return []
    if (opt.teacher) return ['GROUP'] as ScopeType[]
    return (['COMPANY', 'CAMPUS', 'PARTNER', 'TRACK', 'COURSE', 'LEVEL', 'GROUP', 'STUDENTS'] as ScopeType[])
      .filter((s) => (s === 'COMPANY' ? opt.allPlaces : s === 'PARTNER' ? opt.partners.length > 0 : true))
  }, [opt])
  const audienceChoices: Audience[] = opt?.teacher ? ['PARENT', 'STUDENT'] : [...AUDIENCES]
  const items: Item[] = opt && ITEMS_OF[scopeType] ? (opt[ITEMS_OF[scopeType]!] as Item[]) : []
  const shown = items.filter((i) => !find.trim() || i.name.toLowerCase().includes(find.trim().toLowerCase()))

  const { data: students } = useQuery({
    queryKey: ['announcement-student-search', find],
    queryFn: () => fetchApi<Item[] | { items?: { id: string; firstName: string; lastName: string }[] }>(`/api/students?search=${encodeURIComponent(find)}&limit=10`),
    enabled: scopeType === 'STUDENTS' && find.trim().length >= 2,
  })
  const studentHits: Item[] = (Array.isArray(students) ? (students as unknown as { id: string; firstName: string; lastName: string }[]) : (students as { items?: { id: string; firstName: string; lastName: string }[] } | undefined)?.items ?? [])
    .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }))

  const draft = { audiences, scopeType, scopeIds: scopeType === 'STUDENTS' ? picked.map((p) => p.id) : ids }
  const draftKey = JSON.stringify(draft)
  const { data: preview, isFetching: counting } = useQuery({
    queryKey: ['announcement-preview', draftKey],
    queryFn: () => fetchApi<{ count: number; byKind?: Record<string, number>; problem: string | null }>('/api/announcements/preview', { method: 'POST', body: draftKey }),
    enabled: !!opt && audiences.length > 0,
  })

  const upload = async (f: File) => {
    setUploading(true)
    try {
      const sig = await fetchApi<Sig>('/api/upload?folder=announcements')
      const form = new FormData()
      form.append('file', f); form.append('api_key', sig.apiKey); form.append('timestamp', String(sig.timestamp))
      form.append('signature', sig.signature); form.append('folder', sig.folder)
      if (sig.allowedFormats) form.append('allowed_formats', sig.allowedFormats)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.secure_url) throw new Error(json?.error?.message || L('Upload failed', 'الرفع فشل'))
      setFile({ url: json.secure_url, name: f.name })
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const send = useMutation({
    mutationFn: () => fetchApi<{ id: string; status: string }>('/api/announcements', {
      method: 'POST',
      body: JSON.stringify({
        ...draft, title, body, titleAr: titleAr || null, contentAr: contentAr || null, pinned, requireAck: ack,
        attachmentUrl: file?.url ?? null, attachmentName: file?.name ?? null,
        publishAt: publishAt ? new Date(publishAt).toISOString() : null, expiresAt: expiresAt || null,
      }),
    }),
    onSuccess: (r) => {
      notify.success(r.status === 'PENDING' ? L('Sent for approval', 'اتبعت للموافقة') : L('Announcement sent', 'الإعلان اتبعت'))
      setTitle(''); setBody(''); setTitleAr(''); setContentAr(''); setIds([]); setPicked([]); setFile(null); setPinned(false); setPublishAt('')
      qc.invalidateQueries({ queryKey: ['announcements-manage'] })
      onSent()
    },
    onError: (e: Error) => notify.error(e.message),
  })

  if (!opt) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])
  const staffBlocked = audiences.includes('STAFF') && !STAFF_SCOPES.includes(scopeType)
  const textOk = (title.trim().length >= 2 && body.trim().length >= 2)
  const field = 'w-full rounded-md border border-slate-200 bg-white p-2 text-sm'

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1.5 font-semibold text-slate-700">{L('1. Who receives it?', '١. مين يستلمه؟')}</p>
        <div className="flex flex-wrap gap-2">
          {audienceChoices.map((a) => (
            <button key={a} type="button" onClick={() => setAudiences(toggle(audiences, a))}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${audiences.includes(a) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
              {ar ? AUDIENCE_LABEL[a][1] : AUDIENCE_LABEL[a][0]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-semibold text-slate-700">{L('2. Where?', '٢. فين؟')}</p>
        <div className="flex flex-wrap gap-2">
          {scopes.map((s) => (
            <button key={s} type="button" onClick={() => { setScopeType(s); setIds([]); setFind('') }}
              className={`rounded-lg border px-3 py-1.5 text-xs ${scopeType === s ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {ar ? SCOPE_LABEL[s][1] : SCOPE_LABEL[s][0]}
            </button>
          ))}
        </div>
        {staffBlocked && <p className="mt-1 text-xs text-amber-700">{L('Staff are reached by company, branch or partner only.', 'الموظفين بيوصلهم بالشركة أو الفرع أو الشريك بس.')}</p>}
        {scopeType !== 'COMPANY' && (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-2">
            <Input className="h-8" value={find} onChange={(e) => setFind(e.target.value)} placeholder={scopeType === 'STUDENTS' ? L('Search a student (2+ letters)…', 'دوّر على طالب (حرفين أو أكتر)…') : L('Filter…', 'فلتر…')} />
            {scopeType === 'STUDENTS' ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {studentHits.filter((s) => !picked.some((p) => p.id === s.id)).map((s) => (
                    <button key={s.id} type="button" onClick={() => setPicked([...picked, s])} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50">+ {s.name}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.id} className="flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs text-indigo-800">{p.name}
                      <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label="remove"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {shown.length > 1 && (
                  <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setIds(ids.length === shown.length ? [] : shown.map((s) => s.id))}>
                    {ids.length === shown.length ? L('Clear all', 'شيل الكل') : L('Choose all', 'اختار الكل')}
                  </button>
                )}
                {shown.map((i) => (
                  <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input type="checkbox" checked={ids.includes(i.id)} onChange={() => setIds(toggle(ids, i.id))} />{i.name}
                  </label>
                ))}
                {!shown.length && <p className="text-xs text-slate-400">{L('Nothing to choose.', 'مفيش حاجة تختارها.')}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="font-semibold text-slate-700">{L('3. English', '٣. إنجليزي')}</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={L('Title', 'العنوان')} maxLength={190} />
          <textarea className={`${field} min-h-[110px]`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={L('Message', 'الرسالة')} maxLength={10000} />
        </div>
        <div className="space-y-1.5" dir="rtl">
          <p className="font-semibold text-slate-700">{L('Arabic (shown when the screen is Arabic)', 'عربي (بيظهر لما الشاشة عربي)')}</p>
          <Input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} placeholder="العنوان" maxLength={190} />
          <textarea className={`${field} min-h-[110px]`} value={contentAr} onChange={(e) => setContentAr(e.target.value)} placeholder="الرسالة" maxLength={10000} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-slate-600">
          <Paperclip className="h-4 w-4" />{file ? file.name : L('Attach an image / PDF', 'ارفق صورة / PDF')}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        </label>
        {uploading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        {file && <button type="button" className="text-xs text-rose-600" onClick={() => setFile(null)}>{L('remove', 'شيل')}</button>}
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={ack} onChange={(e) => setRequireAck(e.target.checked)} />{L('Must confirm "I read it"', 'لازم يأكّد إنه قرأ')}</label>
        {opt.canApprove && <label className="flex items-center gap-1.5"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />{L('Pin on top', 'ثبّته فوق')}</label>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-slate-600">{L('Publish at (empty = now)', 'ينزل إمتى (فاضي = دلوقتي)')}<DateTimeInput className="h-8 w-52" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-slate-600">{L('Hide after', 'يختفي بعد')}<DateInput className="h-8 w-40" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
        <p className="flex items-center gap-2 text-slate-700">
          <Users className="h-4 w-4 text-indigo-600" />
          {counting ? <Loader2 className="h-4 w-4 animate-spin" /> : preview?.problem ? <span className="text-amber-700">{preview.problem}</span> : (
            <span>{L('Reaches', 'هيوصل لـ')} <b>{preview?.count ?? 0}</b> {L('people', 'شخص')}
              {preview?.byKind && Object.keys(preview.byKind).length > 0 && <span className="text-xs text-slate-500"> ({Object.entries(preview.byKind).map(([k, v]) => `${v} ${ar ? AUDIENCE_LABEL[k as Audience][1] : AUDIENCE_LABEL[k as Audience][0]}`).join(' · ')})</span>}
            </span>
          )}
        </p>
        <Button className="gap-1.5" disabled={!textOk || !preview?.count || !!preview?.problem || send.isPending || uploading} onClick={() => send.mutate()}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {opt.canApprove ? L('Send', 'ابعت') : L('Send for approval', 'ابعت للموافقة')}
        </Button>
      </div>
    </div>
  )
}
