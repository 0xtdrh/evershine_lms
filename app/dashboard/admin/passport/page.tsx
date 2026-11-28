'use client'

/**
 * P1: passport admin — stamps library (automatic / manual / event; ready-made ones editable), event scanning,
 * high-resolution stamp files for a real rubber stamp, and the settings (track graduation, colours, share days,
 * booklet price, company stamp + signature).
 */

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import QRScannerModal from '@/components/QRScannerModal'
import { StampBadge, stampPng, stampSvg } from '@/components/passport/StampBadge'
import { AUTO_RULES, STAMP_SHAPES } from '@/lib/passport/rules'
import { FIELD_KEYS, FIELD_LABELS, isMonthDay, sealSvg, seasonDates, type FieldKey, type Season } from '@/lib/passport/book'
import { PassportCover, Seal } from '@/components/passport/PassportBook'
import { removeWhiteBackground } from '@/lib/images/remove-white'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookMarked, Download, Loader2, Plus, ScanLine } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Stamp {
  id: string; code: string | null; nameEn: string; nameAr: string; descriptionEn: string | null; descriptionAr: string | null; kind: string; rule: string | null; threshold: number | null
  shape: string; color: string; icon: string; givers: string[] | null; repeatable: boolean; secret: boolean; active: boolean; eventFrom: string | null; eventTo: string | null; awards: number
}
interface Settings {
  trackRequired: Record<string, string[]>; trackColors: Record<string, string>; shareDays: number; bookletPrice: number | null; companyStampUrl: string | null; signatureUrl: string | null; signatureName: string
  coverTitleEn: string; coverTitleAr: string; sealMode: 'DRAWN' | 'IMAGE' | 'NONE'; sealTop: string; sealBottom: string
  fields: Record<FieldKey, { passport: boolean; share: boolean }>; seasons: Season[]; stampsPerBook: number; sessionMinutes: number; youngUntil: number
}
interface Tree { tree: { id: string; name: string; courses: { id: string; name: string }[] }[] }

const GIVERS = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'TEACHER']
const KIND_LABEL = (k: string) => (k === 'AUTO' ? L('Automatic', 'تلقائي') : k === 'MANUAL' ? L('By hand', 'يدوي') : L('Event (scan)', 'فعالية (scan)'))
/** S47: role names in Arabic / English for «who can give it» */
const ROLE_NAME: Record<string, [string, string]> = { SUPER_ADMIN: ['Super Admin', 'سوبر أدمن'], ADMIN: ['Admin', 'أدمن'], BRANCH_MANAGER: ['Branch manager', 'مدير الفرع'], SECRETARY: ['Secretary', 'السكرتارية'], TEACHER: ['Instructor', 'المدرب'] }

const blank = (): Partial<Stamp> => ({ nameEn: '', nameAr: '', kind: 'MANUAL', shape: 'ROUND', color: '#4f46e5', icon: '⭐', givers: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'], repeatable: false, secret: false, active: true })

function StampEditor({ value, onDone }: { value: Partial<Stamp>; onDone: () => void }) {
  const { locale } = useI18n()
  // S49: the season templates are the owner's own list (Settings)
  const { data: cfg } = useQuery({ queryKey: ['passport-settings'], queryFn: () => fetchApi<Settings>('/api/passport/settings') })
  const SEASONS = cfg?.seasons ?? []
  const [s, setS] = useState<Partial<Stamp>>(value)
  const set = (p: Partial<Stamp>) => setS((x) => ({ ...x, ...p }))
  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ ...s, givers: s.givers ?? [], eventFrom: s.eventFrom ? s.eventFrom.slice(0, 10) : null, eventTo: s.eventTo ? s.eventTo.slice(0, 10) : null })
      return s.id ? fetchApi(`/api/passport/stamps/${s.id}`, { method: 'PATCH', body }) : fetchApi('/api/passport/stamps', { method: 'POST', body })
    },
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  const builtin = !!s.code
  const rule = s.rule ? AUTO_RULES[s.rule] : null
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-[1fr_auto]">
      <div className="space-y-2">
        {/* owner 28/11 (S43): ready season stamps — an event stamp open between two dates; change anything after */}
        {!s.id && SEASONS.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
            <span className="font-semibold text-slate-600">{L('Season templates:', 'قوالب موسمية:')}</span>
            {SEASONS.map((t) => (
              <button key={t.en} type="button" className="rounded-full border border-slate-300 bg-white px-2 py-1 hover:bg-indigo-50" onClick={() => { const d = seasonDates(t, new Date().getFullYear()); set({ kind: 'EVENT', nameEn: t.en, nameAr: t.ar, icon: t.icon, color: t.color, shape: 'ROUND', repeatable: true, eventFrom: d.from, eventTo: d.to, givers: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'TEACHER'] }); if (t.moves) notify.info(L('This season moves every year — check the dates.', 'الموسم ده بيتحرك كل سنة — راجع التواريخ.')) }}>{t.icon} {L(t.en, t.ar)}{t.moves ? ' ↻' : ''}</button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder={L('Name (English)', 'الاسم (إنجليزي)')} value={s.nameEn ?? ''} onChange={(e) => set({ nameEn: e.target.value })} />
          <Input dir="rtl" placeholder="الاسم (عربي)" value={s.nameAr ?? ''} onChange={(e) => set({ nameAr: e.target.value })} />
          <Input placeholder={L('Description (English, optional)', 'الوصف (إنجليزي، اختياري)')} value={s.descriptionEn ?? ''} onChange={(e) => set({ descriptionEn: e.target.value })} />
          <Input dir="rtl" placeholder="الوصف (عربي، اختياري)" value={s.descriptionAr ?? ''} onChange={(e) => set({ descriptionAr: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={s.kind} disabled={builtin} onValueChange={(k) => set({ kind: k })}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{['AUTO', 'MANUAL', 'EVENT'].map((k) => <SelectItem key={k} value={k}>{KIND_LABEL(k)}</SelectItem>)}</SelectContent>
          </Select>
          {s.kind === 'AUTO' && (
            <Select value={s.rule ?? ''} disabled={builtin} onValueChange={(r) => set({ rule: r })}>
              <SelectTrigger className="h-9 w-80"><SelectValue placeholder={L('When is it given?', 'بيتاخد إمتى؟')} /></SelectTrigger>
              <SelectContent>{Object.entries(AUTO_RULES).map(([k, v]) => <SelectItem key={k} value={k}>{locale === 'ar' ? v.ar : v.en}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {s.kind === 'AUTO' && rule?.threshold && <label className="flex items-center gap-1">N = <Input type="number" min={1} className="h-9 w-24" value={s.threshold ?? ''} onChange={(e) => set({ threshold: Number(e.target.value) || null })} /></label>}
        </div>
        {s.kind === 'EVENT' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">{L('Open from', 'مفتوح من')} <DateInput className="h-8 w-40" value={s.eventFrom?.slice(0, 10) ?? ''} onChange={(e) => set({ eventFrom: e.target.value || null })} /> {L('to', 'لحد')} <DateInput className="h-8 w-40" value={s.eventTo?.slice(0, 10) ?? ''} onChange={(e) => set({ eventTo: e.target.value || null })} /> <span className="text-slate-400">{L('(empty = always)', '(فاضي = دايمًا)')}</span></div>
        )}
        {s.kind !== 'AUTO' && (
          <div className="flex flex-wrap items-center gap-3 text-xs"><span className="text-slate-500">{L('Who can give it', 'مين يقدر يدّيه')}:</span>
            {GIVERS.map((g) => <label key={g} className="flex items-center gap-1"><input type="checkbox" checked={(s.givers ?? []).includes(g)} onChange={(e) => set({ givers: e.target.checked ? [...(s.givers ?? []), g] : (s.givers ?? []).filter((x) => x !== g) })} /> {L(ROLE_NAME[g]?.[0] ?? g, ROLE_NAME[g]?.[1] ?? g)}</label>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={s.shape} onValueChange={(v) => set({ shape: v })}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent>{STAMP_SHAPES.map((x) => <SelectItem key={x} value={x}>{x === 'ROUND' ? L('Round', 'دايرة') : x === 'SQUARE' ? L('Square', 'مربع') : L('Hexagon', 'سداسي')}</SelectItem>)}</SelectContent></Select>
          <label className="flex items-center gap-1 text-xs">{L('Colour', 'اللون')} <input type="color" value={s.color ?? '#4f46e5'} onChange={(e) => set({ color: e.target.value })} className="h-8 w-10 rounded border" /></label>
          <label className="flex items-center gap-1 text-xs">{L('Icon (emoji)', 'أيقونة (إيموجي)')} <Input className="h-8 w-20 text-center" maxLength={4} value={s.icon ?? ''} onChange={(e) => set({ icon: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={!!s.repeatable} onChange={(e) => set({ repeatable: e.target.checked })} /> {L('Can be taken more than once', 'ينفع يتاخد أكتر من مرة')}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={!!s.secret} onChange={(e) => set({ secret: e.target.checked })} /> {L('Secret (hidden until taken)', 'سرّي (مايبانش غير لما يتاخد)')}</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={s.active !== false} onChange={(e) => set({ active: e.target.checked })} /> {L('On', 'شغال')}</label>
        </div>
        <Button disabled={save.isPending || !s.nameEn?.trim()} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{L('Save stamp', 'احفظ الختم')}</Button>
      </div>
      <div className="flex flex-col items-center gap-2"><StampBadge stamp={{ nameEn: s.nameEn || 'Stamp', nameAr: s.nameAr || s.nameEn || 'ختم', icon: s.icon ?? '', shape: s.shape ?? 'ROUND', color: s.color ?? '#4f46e5', date: new Date() }} ar={locale === 'ar'} size={170} /><span className="text-xs text-slate-400">{L('Preview', 'معاينة')}</span></div>
    </div>
  )
}

function EventScan({ stamp, onClose }: { stamp: Stamp; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [cam, setCam] = useState(false)
  const scan = async (c: string) => {
    if (!c.trim()) return
    try {
      const r = await fetchApi<{ student: string; already: boolean }>(`/api/passport/stamps/${stamp.id}/scan`, { method: 'POST', body: JSON.stringify({ code: c.trim() }) })
      setLog((l) => [`${r.already ? '↺' : '✅'} ${r.student}${r.already ? ` — ${L('already has it', 'معاه الختم')}` : ''}`, ...l].slice(0, 50))
    } catch (e) { setLog((l) => [`❌ ${(e as Error).message}`, ...l].slice(0, 50)) }
    setCode('')
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">{L('Scan the student card with the camera, or with a USB scanner into the box (it presses Enter by itself).', 'اعمل scan لكارت الطالب بالكاميرا، أو بجهاز scanner في الخانة (هو بيدوس Enter لوحده).')}</p>
      <div className="flex gap-2">
        <Input autoFocus value={code} placeholder="TN-QR-…" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scan(code) }} />
        <Button variant="outline" onClick={() => setCam(true)}><ScanLine className="h-4 w-4" /></Button>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">{log.map((x, i) => <p key={i} className="text-xs">{x}</p>)}</div>
      <Button variant="outline" onClick={onClose}>{L('Done', 'خلصت')}</Button>
      <QRScannerModal open={cam} onClose={() => setCam(false)} onDetected={(c) => scan(c)} />
    </div>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const { locale } = useI18n()
  const { data } = useQuery({ queryKey: ['passport-settings'], queryFn: () => fetchApi<Settings>('/api/passport/settings') })
  const { data: tree } = useQuery({ queryKey: ['curriculum-tree'], queryFn: () => fetchApi<Tree>('/api/curriculum/tree') })
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { if (data) setS(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/passport/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['passport-settings'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  const upload = async (file: File, key: 'companyStampUrl' | 'signatureUrl') => {
    try {
      const sig = await fetchApi<{ cloudName: string; apiKey: string; timestamp: number; signature: string; folder: string; allowedFormats?: string }>('/api/upload?folder=documents')
      const fd = new FormData()
      // S49: the photo of a stamp / signature on white paper → the white becomes see-through
      const clean = await removeWhiteBackground(file).catch(() => file)
      fd.append('file', clean); fd.append('api_key', sig.apiKey); fd.append('timestamp', String(sig.timestamp)); fd.append('signature', sig.signature); fd.append('folder', sig.folder)
      if (sig.allowedFormats) fd.append('allowed_formats', sig.allowedFormats)
      const r = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error?.message || 'Upload failed')
      setS((x) => (x ? { ...x, [key]: j.secure_url } : x))
    } catch (e) { notify.error((e as Error).message) }
  }
  if (!s) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const tracks = tree?.tree ?? []
  const look = { titleEn: s.coverTitleEn, titleAr: s.coverTitleAr, sealMode: s.sealMode, sealTop: s.sealTop, sealBottom: s.sealBottom, sealImage: s.sealMode === 'IMAGE' ? s.companyStampUrl : null, signature: s.signatureUrl, signatureName: s.signatureName }
  const downloadSeal = () => {
    const svg = sealSvg({ top: s.sealTop, bottom: s.sealBottom, mono: true }).replace('width="200" height="200"', 'width="40mm" height="40mm"')
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = 'technova-seal.svg'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const setSeason = (i: number, p: Partial<Season>) => setS({ ...s, seasons: s.seasons.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const badSeason = s.seasons.some((x) => !x.en.trim() || !x.ar.trim() || !isMonthDay(x.from) || !isMonthDay(x.to))
  const saveBtn = <Button disabled={save.isPending || badSeason} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{L('Save settings', 'احفظ الإعدادات')}</Button>
  return (
    <div className="space-y-4">
      {/* S49: cover, seal and signature */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Cover, seal and signature', 'الغلاف والختم والتوقيع')}</CardTitle><CardDescription>{L('What is written on the cover, and what signs the data page: the drawn TechNova seal, your own stamp photo, or your signature only.', 'المكتوب على الغلاف، واللي بيمضي صفحة البيانات: ختم TechNova المرسوم، أو صورة ختمك الحقيقي، أو إمضتك بس.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-[1fr_220px]">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-xs text-slate-500">{L('Cover title (English)', 'اسم الغلاف (إنجليزي)')}</span><Input maxLength={40} value={s.coverTitleEn} onChange={(e) => setS({ ...s, coverTitleEn: e.target.value })} /></label>
              <label className="space-y-1"><span className="text-xs text-slate-500">{L('Cover title (Arabic)', 'اسم الغلاف (عربي)')}</span><Input dir="rtl" maxLength={40} value={s.coverTitleAr} onChange={(e) => setS({ ...s, coverTitleAr: e.target.value })} /></label>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-600">{L('The seal on the data page', 'الختم على صفحة البيانات')}</p>
              {([['DRAWN', L('Drawn TechNova seal', 'ختم TechNova المرسوم')], ['IMAGE', L('My own stamp (photo)', 'ختمي الحقيقي (صورة)')], ['NONE', L('No seal — signature only', 'من غير ختم — الإمضاء بس')]] as const).map(([k, label]) => (
                <label key={k} className="flex min-h-9 items-center gap-2"><input type="radio" name="sealMode" checked={s.sealMode === k} onChange={() => setS({ ...s, sealMode: k })} /> {label}</label>
              ))}
            </div>
            {s.sealMode === 'DRAWN' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-xs text-slate-500">{L('Seal text — top', 'كلام الختم — فوق')}</span><Input maxLength={34} value={s.sealTop} onChange={(e) => setS({ ...s, sealTop: e.target.value })} /></label>
                <label className="space-y-1"><span className="text-xs text-slate-500">{L('Seal text — bottom', 'كلام الختم — تحت')}</span><Input maxLength={34} value={s.sealBottom} onChange={(e) => setS({ ...s, sealBottom: e.target.value })} /></label>
                <Button type="button" variant="outline" size="sm" className="w-fit gap-1" onClick={downloadSeal}><Download className="h-3 w-3" /> {L('Seal as SVG (for a rubber stamp)', 'الختم SVG (لمحل الأختام)')}</Button>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-6">
              {(['companyStampUrl', 'signatureUrl'] as const).filter((k) => k === 'signatureUrl' || s.sealMode === 'IMAGE').map((k) => (
                <div key={k} className="space-y-1">
                  <p className="text-xs text-slate-500">{k === 'companyStampUrl' ? L('My stamp (photo on white paper)', 'ختمي (صورة على ورقة بيضا)') : L('My signature (photo on white paper, optional)', 'إمضتي (صورة على ورقة بيضا، اختياري)')}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s[k] ? <img src={s[k]!} alt="" className="h-20 w-auto rounded border bg-white p-1" /> : <div className="flex h-20 w-28 items-center justify-center rounded border border-dashed text-xs text-slate-400">—</div>}
                  <div className="flex items-center gap-2">
                    <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50">
                      📷 {s[k] ? L('Change photo', 'غيّر الصورة') : L('Choose a photo', 'اختار صورة')}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, k); e.target.value = '' }} />
                    </label>
                    {s[k] && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-rose-600" onClick={() => setS({ ...s, [k]: null })}>{L('Remove', 'شيل')}</Button>}
                  </div>
                </div>
              ))}
            </div>
            <label className="flex flex-wrap items-center gap-2">{L('Name under the signature', 'الاسم تحت الإمضاء')} <Input className="h-8 w-64" value={s.signatureName} placeholder={L('e.g. Kerolos — CEO', 'مثلاً: كيرلس — المدير')} onChange={(e) => setS({ ...s, signatureName: e.target.value })} /></label>
            {s.sealMode === 'IMAGE' && !s.companyStampUrl && <p className="text-xs text-amber-700">{L('Upload your stamp photo first.', 'ارفع صورة ختمك الأول.')}</p>}
            {saveBtn}
          </div>
          <div className="space-y-3">
            <p className="text-center text-xs text-slate-400">{L('Preview', 'معاينة')}</p>
            <div className="pointer-events-none"><PassportCover look={look} ar={locale === 'ar'} number="TN-PASS-2026-0001" edition={1} young={false} /></div>
            <div className="flex justify-center rounded-xl border bg-white p-3"><Seal look={look} size={110} />{look.sealMode === 'NONE' && <span className="text-xs text-slate-400">{L('signature only', 'الإمضاء بس')}</span>}</div>
          </div>
        </CardContent>
      </Card>

      {/* S49: which data shows in the passport and in the share link */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Data page — what shows', 'صفحة البيانات — إيه اللي يظهر')}</CardTitle><CardDescription>{L('The share link is seen by strangers (a school, relatives): keep age and school off there unless you need them. Phone numbers and money never show.', 'اللينك المشارك بيشوفه ناس من بره (مدرسة، قرايب): خلّي السن والمدرسة مقفولين فيه إلا لو محتاجهم. أرقام التليفونات والفلوس عمرها ما بتظهر.')}</CardDescription></CardHeader>
        <CardContent className="text-sm">
          <table className="w-full text-start">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 text-start">{L('Field', 'البيانة')}</th><th className="w-24 text-center">{L('In the passport', 'في الجواز')}</th><th className="w-24 text-center">{L('In the share link', 'في اللينك المشارك')}</th></tr></thead>
            <tbody>{FIELD_KEYS.map((k) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="py-1.5">{L(FIELD_LABELS[k].en, FIELD_LABELS[k].ar)}</td>
                {(['passport', 'share'] as const).map((w) => (
                  <td key={w} className="text-center"><input type="checkbox" className="h-4 w-4" aria-label={`${k} ${w}`} checked={s.fields[k][w]} onChange={(e) => setS({ ...s, fields: { ...s.fields, [k]: { ...s.fields[k], [w]: e.target.checked } } })} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1">{L('Session length when the group has none', 'مدة الحصة لو الجروب مالوش مدة')} <Input type="number" min={15} max={480} className="h-8 w-20" value={s.sessionMinutes} onChange={(e) => setS({ ...s, sessionMinutes: Number(e.target.value) || 60 })} /> {L('minutes', 'دقيقة')}</label>
            <label className="flex items-center gap-1">{L('Young-kids look up to age', 'شكل الصغيرين لحد سن')} <Input type="number" min={0} max={18} className="h-8 w-16" value={s.youngUntil} onChange={(e) => setS({ ...s, youngUntil: Number(e.target.value) || 0 })} /></label>
            <label className="flex items-center gap-1">{L('New passport every', 'جواز جديد كل')} <Input type="number" min={6} max={200} className="h-8 w-20" value={s.stampsPerBook} onChange={(e) => setS({ ...s, stampsPerBook: Number(e.target.value) || 24 })} /> {L('stamps', 'ختم')}</label>
          </div>
          <div className="mt-3">{saveBtn}</div>
        </CardContent>
      </Card>

      {/* S49: season templates — the owner's own list */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Season templates', 'القوالب الموسمية')}</CardTitle><CardDescription>{L('Ready event stamps for seasons. ↻ = the date moves every year (Ramadan, the Eids, Sham El-Nessim): update it each year. Dates as MM-DD.', 'أختام فعاليات جاهزة للمواسم. ↻ = التاريخ بيتحرك كل سنة (رمضان، العيدين، شم النسيم): عدّله كل سنة. التاريخ شهر-يوم (MM-DD).')}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {s.seasons.map((x, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-2">
              <Input className="h-8 w-14 text-center" maxLength={4} value={x.icon} onChange={(e) => setSeason(i, { icon: e.target.value })} />
              <Input dir="rtl" className="h-8 w-36" value={x.ar} placeholder="عربي" onChange={(e) => setSeason(i, { ar: e.target.value })} />
              <Input className="h-8 w-36" value={x.en} placeholder="English" onChange={(e) => setSeason(i, { en: e.target.value })} />
              <input type="color" value={x.color} onChange={(e) => setSeason(i, { color: e.target.value })} className="h-8 w-9 rounded border" />
              <Input className={`h-8 w-20 font-mono ${isMonthDay(x.from) ? '' : 'border-rose-400'}`} value={x.from} placeholder="MM-DD" onChange={(e) => setSeason(i, { from: e.target.value })} />
              <span className="text-xs text-slate-400">→</span>
              <Input className={`h-8 w-20 font-mono ${isMonthDay(x.to) ? '' : 'border-rose-400'}`} value={x.to} placeholder="MM-DD" onChange={(e) => setSeason(i, { to: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!x.moves} onChange={(e) => setSeason(i, { moves: e.target.checked })} /> ↻ {L('moves', 'بيتحرك')}</label>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-rose-600" onClick={() => setS({ ...s, seasons: s.seasons.filter((_, j) => j !== i) })}>{L('Remove', 'شيل')}</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1" disabled={s.seasons.length >= 40} onClick={() => setS({ ...s, seasons: [...s.seasons, { en: '', ar: '', icon: '⭐', color: '#1E7FA0', from: '01-01', to: '01-07' }] })}><Plus className="h-3 w-3" /> {L('Add a season', 'ضيف موسم')}</Button>
            {saveBtn}
          </div>
          {badSeason && <p className="text-xs text-rose-600">{L('Every season needs both names and dates as MM-DD.', 'كل موسم محتاج الاسمين والتاريخ بالشكل MM-DD.')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Track graduation and colours', 'التخرّج من الـ Track والألوان')}</CardTitle><CardDescription>{L('Tick the courses a student must finish (last level passed) to graduate. Nothing ticked = every course of the track. The colour is used for the level stamps and the passport cover.', 'علّم الكورسات اللي لازم الطالب يخلّصها (ينجح في آخر مستوى) علشان يتخرّج. لو مفيش علامة = كل كورسات الـ Track. اللون بيُستخدم لأختام المستويات وغلاف الجواز.')}</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {tracks.map((t) => (
            <div key={t.id} className="space-y-1 rounded-lg border border-slate-100 p-2">
              <div className="flex items-center gap-2"><span className="font-medium">{t.name}</span><input type="color" value={s.trackColors[t.id] ?? '#4f46e5'} onChange={(e) => setS({ ...s, trackColors: { ...s.trackColors, [t.id]: e.target.value } })} className="h-7 w-9 rounded border" /></div>
              <div className="flex flex-wrap gap-3 text-xs">{t.courses.map((c) => {
                const req = s.trackRequired[t.id] ?? []
                return <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={req.includes(c.id)} onChange={(e) => setS({ ...s, trackRequired: { ...s.trackRequired, [t.id]: e.target.checked ? [...req, c.id] : req.filter((x) => x !== c.id) } })} /> {c.name}</label>
              })}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Sharing, printing, transcript', 'المشاركة والطباعة وكشف الدرجات')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-center gap-2">{L('Share link open for', 'لينك المشاركة مفتوح')} <Input type="number" min={1} max={365} className="h-8 w-20" value={s.shareDays} onChange={(e) => setS({ ...s, shareDays: Number(e.target.value) || 30 })} /> {L('days', 'يوم')}</label>
          <label className="flex items-center gap-2">{L('Paper passport price (empty = free)', 'سعر الجواز الورقي (فاضي = ببلاش)')} <Input type="number" min={0} className="h-8 w-28" value={s.bookletPrice ?? ''} onChange={(e) => setS({ ...s, bookletPrice: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save settings', 'احفظ الإعدادات')}</Button>
          <p className="text-xs text-slate-400">{locale === 'ar' ? 'الطباعة للموظفين بس (أدمن، مدير فرع، سكرتارية) وكل طبعة بتتسجل برقم نسخة. ولي الأمر والطالب بيشوفوا بس.' : 'Printing is for branch staff only (admin, branch manager, secretary); every print is logged with a copy number. Parents and students only look.'}</p>
        </CardContent>
      </Card>
    </div>
  )
}

interface ProfileSettings { olderAge: number; maxVideoSeconds: number; maxUploadMb: number; parentPortfolio: boolean; thanksOn: boolean; diaryOn: boolean; uploadsOn: boolean }
/** P2: profile settings (older-student age, uploads, thank-you notes, diary, portfolio for parents). */
function ProfileSettingsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['profile-settings'], queryFn: () => fetchApi<ProfileSettings>('/api/profile/settings') })
  const [s, setS] = useState<ProfileSettings | null>(null)
  useEffect(() => { if (data) setS(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/profile/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['profile-settings'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  if (!s) return null
  const num = (k: 'olderAge' | 'maxVideoSeconds' | 'maxUploadMb', label: string) => <label className="flex items-center gap-2">{label} <Input type="number" className="h-8 w-20" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) || 1 })} /></label>
  const box = (k: 'parentPortfolio' | 'thanksOn' | 'diaryOn' | 'uploadsOn', label: string) => <label className="flex items-center gap-2"><input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} /> {label}</label>
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Profile', 'البروفايل')}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {num('olderAge', L('"Older students" from age', '«الطلبة الكبار» من سن'))}
        {num('maxVideoSeconds', L('Longest video (seconds)', 'أطول فيديو (ثانية)'))}
        {num('maxUploadMb', L('Biggest file (MB)', 'أكبر ملف (MB)'))}
        {box('uploadsOn', L('Project uploads (instructor; older students with approval)', 'رفع المشاريع (المدرب؛ والطلبة الكبار بموافقة)'))}
        {box('thanksOn', L('Thank-you notes between classmates (instructor approves)', 'رسايل شكر بين الزملاء (المدرب يوافق)'))}
        {box('diaryOn', L("Inventor's diary (older students)", 'مذكرات المخترع (الطلبة الكبار)'))}
        {box('parentPortfolio', L('Parents can open the portfolio (older students)', 'ولي الأمر يقدر يفتح الـ Portfolio (الطلبة الكبار)'))}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'حفظ')}</Button>
      </CardContent>
    </Card>
  )
}

export default function PassportAdminPage() {
  const [urlTab, setUrlTab] = useUrlTab()
  const { data: session } = useSession()
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const role = session?.user?.role ?? ''
  const { can, ready: permsReady } = useMyPermissions() // effective permissions (Permissions page + overrides)
  const allowed = can('passport', 'read')
  const canEdit = can('passport', 'approve')
  const { data, isLoading } = useQuery({ queryKey: ['passport-stamps'], queryFn: () => fetchApi<Stamp[]>('/api/passport/stamps'), enabled: allowed })
  const [edit, setEdit] = useState<Partial<Stamp> | null>(null)
  const [scan, setScan] = useState<Stamp | null>(null)
  if (!role) return null
  if (role && !permsReady) return null
  if (!allowed) return <AccessDenied title={L('Passport', 'الجواز')} message={L("You don't have access to the passport settings.", 'مش عندك صلاحية لإعدادات الجواز.')} />
  const download = async (s: Stamp) => {
    const url = await stampPng({ ...s, nameAr: s.nameAr || s.nameEn, date: null }, ar, { size: 2000, mono: true })
    const a = document.createElement('a'); a.href = url; a.download = `stamp-${s.code ?? s.id}.png`; a.click()
  }
  // owner 28/11: stamp makers prefer a sharp vector file (SVG) for engraving a real rubber stamp
  const downloadSvg = (s: Stamp) => {
    const svg = stampSvg({ ...s, nameAr: s.nameAr || s.nameEn, date: null }, ar, { mono: true }).replace('width="200" height="200"', 'width="60mm" height="60mm"')
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = `stamp-${s.code ?? s.id}.svg`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const kinds = ['AUTO', 'MANUAL', 'EVENT']
  return (
    <div className="space-y-4" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookMarked className="h-7 w-7 text-indigo-600" /> {L('Passport & stamps', 'الجواز والأختام')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Automatic stamps are given by the system; by-hand stamps by the roles you choose; event stamps by scanning the student card on the day.', 'الأختام التلقائية السيستم بيدّيها لوحده؛ اليدوية بيدّيها اللي تختارهم؛ وأختام الفعاليات بالـ scan على كارت الطالب في يومها.')}</p>
      </div>
      <Tabs value={urlTab ?? 'stamps'} onValueChange={setUrlTab}>
        <TabsList><TabsTrigger value="stamps">{L('Stamps', 'الأختام')}</TabsTrigger>{canEdit && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}</TabsList>
        <TabsContent value="stamps" className="space-y-4">
          {canEdit && <Button className="gap-1" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" /> {L('New stamp', 'ختم جديد')}</Button>}
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : kinds.map((k) => {
            const list = (data ?? []).filter((s) => s.kind === k)
            if (!list.length) return null
            return (
              <Card key={k}>
                <CardHeader className="pb-2"><CardTitle className="text-base">{KIND_LABEL(k)}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {list.map((s) => (
                    <div key={s.id} className={`flex flex-col items-center gap-1 text-center ${s.active ? '' : 'opacity-40'}`}>
                      <StampBadge stamp={{ ...s, nameAr: s.nameAr || s.nameEn }} ar={ar} size={110} />
                      <p className="text-[11px] text-slate-500">{s.kind === 'AUTO' && s.rule ? (ar ? AUTO_RULES[s.rule]?.ar : AUTO_RULES[s.rule]?.en)?.replace('N', String(s.threshold ?? 'N')) : ''}{s.secret ? ` · ${L('secret', 'سرّي')}` : ''} · {s.awards} {L('given', 'اتاخد')}</p>
                      <div className="flex flex-wrap justify-center gap-1">
                        {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEdit(s)}>{L('Edit', 'تعديل')}</Button>}
                        {s.kind === 'EVENT' && s.active && <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setScan(s)}><ScanLine className="h-3 w-3" /> {L('Scan', 'Scan')}</Button>}
                        <Button size="sm" variant="ghost" className="h-7 px-2" title={L('High-resolution file for a rubber stamp', 'ملف عالي الجودة للختم المطاط')} onClick={() => download(s)}><Download className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" title={L('Vector file (SVG) for the stamp maker', 'ملف SVG لمحل الأختام')} onClick={() => downloadSvg(s)}>SVG</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>
        {canEdit && <TabsContent value="settings" className="space-y-4"><SettingsTab /><ProfileSettingsCard /></TabsContent>}
      </Tabs>
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{edit?.id ? L('Edit stamp', 'تعديل الختم') : L('New stamp', 'ختم جديد')}</DialogTitle></DialogHeader>{edit && <StampEditor value={edit} onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['passport-stamps'] }) }} />}</DialogContent>
      </Dialog>
      <Dialog open={!!scan} onOpenChange={(o) => { if (!o) setScan(null) }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{scan?.icon} {scan ? (ar ? scan.nameAr || scan.nameEn : scan.nameEn) : ''}</DialogTitle></DialogHeader>{scan && <EventScan stamp={scan} onClose={() => setScan(null)} />}</DialogContent>
      </Dialog>
    </div>
  )
}
