'use client'

/**
 * P1: passport admin — stamps library (automatic / manual / event; ready-made ones editable), event scanning,
 * high-resolution stamp files for a real rubber stamp, and the settings (track graduation, colours, share days,
 * booklet price, company stamp + signature).
 */

import { useUrlTab } from '@/hooks/use-url-tab'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { L, useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import QRScannerModal from '@/components/QRScannerModal'
import { StampBadge, stampPng } from '@/components/passport/StampBadge'
import { AUTO_RULES, STAMP_SHAPES } from '@/lib/passport/rules'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookMarked, Download, Loader2, Plus, ScanLine } from 'lucide-react'

interface Stamp {
  id: string; code: string | null; nameEn: string; nameAr: string; descriptionEn: string | null; descriptionAr: string | null; kind: string; rule: string | null; threshold: number | null
  shape: string; color: string; icon: string; givers: string[] | null; repeatable: boolean; secret: boolean; active: boolean; eventFrom: string | null; eventTo: string | null; awards: number
}
interface Settings { trackRequired: Record<string, string[]>; trackColors: Record<string, string>; shareDays: number; bookletPrice: number | null; companyStampUrl: string | null; signatureUrl: string | null; signatureName: string }
interface Tree { tree: { id: string; name: string; courses: { id: string; name: string }[] }[] }

const GIVERS = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'TEACHER']
const KIND_LABEL = (k: string) => (k === 'AUTO' ? L('Automatic', 'تلقائي') : k === 'MANUAL' ? L('By hand', 'يدوي') : L('Event (scan)', 'فعالية (scan)'))
const blank = (): Partial<Stamp> => ({ nameEn: '', nameAr: '', kind: 'MANUAL', shape: 'ROUND', color: '#4f46e5', icon: '⭐', givers: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'], repeatable: false, secret: false, active: true })

function StampEditor({ value, onDone }: { value: Partial<Stamp>; onDone: () => void }) {
  const { locale } = useI18n()
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
          <div className="flex flex-wrap items-center gap-2 text-xs">{L('Open from', 'مفتوح من')} <Input type="date" className="h-8 w-40" value={s.eventFrom?.slice(0, 10) ?? ''} onChange={(e) => set({ eventFrom: e.target.value || null })} /> {L('to', 'لحد')} <Input type="date" className="h-8 w-40" value={s.eventTo?.slice(0, 10) ?? ''} onChange={(e) => set({ eventTo: e.target.value || null })} /> <span className="text-slate-400">{L('(empty = always)', '(فاضي = دايمًا)')}</span></div>
        )}
        {s.kind !== 'AUTO' && (
          <div className="flex flex-wrap items-center gap-3 text-xs"><span className="text-slate-500">{L('Who can give it', 'مين يقدر يدّيه')}:</span>
            {GIVERS.map((g) => <label key={g} className="flex items-center gap-1"><input type="checkbox" checked={(s.givers ?? []).includes(g)} onChange={(e) => set({ givers: e.target.checked ? [...(s.givers ?? []), g] : (s.givers ?? []).filter((x) => x !== g) })} /> {g.replace('_', ' ').toLowerCase()}</label>)}
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
      fd.append('file', file); fd.append('api_key', sig.apiKey); fd.append('timestamp', String(sig.timestamp)); fd.append('signature', sig.signature); fd.append('folder', sig.folder)
      if (sig.allowedFormats) fd.append('allowed_formats', sig.allowedFormats)
      const r = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error?.message || 'Upload failed')
      setS((x) => (x ? { ...x, [key]: j.secure_url } : x))
    } catch (e) { notify.error((e as Error).message) }
  }
  if (!s) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const tracks = tree?.tree ?? []
  return (
    <div className="space-y-4">
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
          <div className="flex flex-wrap items-center gap-6">
            {(['companyStampUrl', 'signatureUrl'] as const).map((k) => (
              <div key={k} className="space-y-1">
                <p className="text-xs text-slate-500">{k === 'companyStampUrl' ? L('Company stamp (image)', 'ختم الشركة (صورة)') : L('Signature (image)', 'الإمضاء (صورة)')}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s[k] ? <img src={s[k]!} alt="" className="h-20 w-auto rounded border bg-white p-1" /> : <div className="flex h-20 w-28 items-center justify-center rounded border border-dashed text-xs text-slate-400">—</div>}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, k) }} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2">{L('Name under the signature', 'الاسم تحت الإمضاء')} <Input className="h-8 w-64" value={s.signatureName} onChange={(e) => setS({ ...s, signatureName: e.target.value })} /></label>
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
  const allowed = !!role && checkPermission(role, 'passport', 'read')
  const canEdit = !!role && checkPermission(role, 'passport', 'approve')
  const { data, isLoading } = useQuery({ queryKey: ['passport-stamps'], queryFn: () => fetchApi<Stamp[]>('/api/passport/stamps'), enabled: allowed })
  const [edit, setEdit] = useState<Partial<Stamp> | null>(null)
  const [scan, setScan] = useState<Stamp | null>(null)
  if (!role) return null
  if (!allowed) return <AccessDenied title={L('Passport', 'الجواز')} message={L("You don't have access to the passport settings.", 'مش عندك صلاحية لإعدادات الجواز.')} />
  const download = async (s: Stamp) => {
    const url = await stampPng({ ...s, nameAr: s.nameAr || s.nameEn, date: null }, ar, { size: 2000, mono: true })
    const a = document.createElement('a'); a.href = url; a.download = `stamp-${s.code ?? s.id}.png`; a.click()
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
