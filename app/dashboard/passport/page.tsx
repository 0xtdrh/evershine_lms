'use client'

/**
 * P1: the TechNova passport. Student: own. Parent: a child (+ share links). Staff / instructor: ?s=<studentId>
 * (+ give stamps; branch staff print). Families only look — no printing / download (owner 2026-10-12).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Watermark } from '@/components/curriculum/Watermark'
import { StampBadge, stampPng } from '@/components/passport/StampBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookMarked, Copy, Loader2, Printer, Share2, Trash2 } from 'lucide-react'

interface Stamp { id: string; stampId: string; nameEn: string; nameAr: string; icon: string; shape: string; color: string; label: string | null; awardedAt: string; source: string; note: string | null; isNew: boolean }
interface Passport {
  viewer: string; canManage: boolean; canPrint: boolean
  passport: { number: string; issuedAt: string }
  student: { id: string; name: string; nameAr: string | null; reg: string; photo: string | null; joinedAt: string; campus: string; cardCode: string | null }
  cover: string
  stamps: Stamp[]
  manualStamps: { id: string; nameEn: string; nameAr: string; icon: string }[]
  certificates: { id: string; title: string; number: string | null; issuedAt: string; revealed: boolean }[]
  projects: { id: string; titleEn: string; titleAr: string }[]
  shares: { id: string; token: string; expiresAt: string; showProjects: boolean; showPhoto: boolean; views: number }[]
  prints: { kind: string; copyNo: number; price: number | null; at: string }[]
  shareDays: number; bookletPrice: number | null
}

const day = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function PassportPage() {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data: session } = useSession()
  const sp = useSearchParams()
  const staffStudent = sp.get('s')
  const { data: mine } = useQuery({ queryKey: ['passport-me'], queryFn: () => fetchApi<{ id: string; name: string }[]>('/api/passport/me'), enabled: !staffStudent })
  const [pick, setPick] = useState('')
  const studentId = staffStudent || pick || mine?.[0]?.id || ''
  const { data: p, isLoading, error } = useQuery({ queryKey: ['passport', studentId], queryFn: () => fetchApi<Passport>(`/api/passport/${studentId}`), enabled: !!studentId, retry: false })
  const [qr, setQr] = useState('')
  useEffect(() => { if (p?.student.cardCode) QRCode.toDataURL(p.student.cardCode, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')) }, [p?.student.cardCode])
  const refresh = () => qc.invalidateQueries({ queryKey: ['passport', studentId] })

  // parent: share links
  const [showProjects, setShowProjects] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const share = useMutation({
    mutationFn: () => fetchApi(`/api/passport/${studentId}/share`, { method: 'POST', body: JSON.stringify({ showProjects, showPhoto, showSkills }) }),
    onSuccess: () => { notify.success(L('Link made', 'اللينك اتعمل')); refresh() }, onError: (e: Error) => notify.error(e.message),
  })
  const stop = useMutation({ mutationFn: (id: string) => fetchApi(`/api/passport/shares/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  // staff: give a stamp
  const [giveId, setGiveId] = useState('')
  const [note, setNote] = useState('')
  const give = useMutation({
    mutationFn: () => fetchApi<{ given: number }>('/api/passport/stamps/give', { method: 'POST', body: JSON.stringify({ stampId: giveId, studentIds: [studentId], note: note || null }) }),
    onSuccess: (r) => { notify.success(r.given ? L('Stamp given', 'الختم اتحط') : L('Already has this stamp', 'معاه الختم ده')); setNote(''); refresh() }, onError: (e: Error) => notify.error(e.message),
  })

  const shareImage = async (s: Stamp) => {
    try {
      const url = await stampPng(s, ar, { share: { title: p!.student.name.split(' ')[0], line: ar ? `ختم جديد في جواز TechNova: ${s.nameAr}` : `New stamp in the TechNova passport: ${s.nameEn}` } })
      const blob = await (await fetch(url)).blob()
      const file = new File([blob], 'technova-stamp.png', { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'TechNova' })
      else { const a = document.createElement('a'); a.href = url; a.download = 'technova-stamp.png'; a.click() }
    } catch { /* closed */ }
  }

  if (!studentId) return <p className="text-sm text-slate-500">{mine && !mine.length ? L('No passport here.', 'مفيش جواز هنا.') : <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}</p>
  if (error) return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (isLoading || !p) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const family = p.viewer === 'STUDENT' || p.viewer === 'PARENT'
  const base = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookMarked className="h-7 w-7 text-indigo-600" /> {L('TechNova passport', 'جواز سفر TechNova')}</h1>
        <Link href={`/dashboard/profile${staffStudent ? `?s=${studentId}` : ''}`} className="text-sm text-indigo-700 hover:underline">👤 {L('Profile', 'البروفايل')} →</Link>
        {!staffStudent && (mine?.length ?? 0) > 1 && (
          <Select value={studentId} onValueChange={setPick}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger><SelectContent>{mine!.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
        )}
      </div>

      {/* identity page */}
      <div className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${p.cover}, #0f172a)` }}>
        <div className="flex flex-wrap items-center gap-5">
          {p.student.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.student.photo} alt="" className="h-28 w-24 rounded-xl border-2 border-white/70 object-cover" />
            : <div className="flex h-28 w-24 items-center justify-center rounded-xl border-2 border-white/50 text-4xl">👤</div>}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-white/70">{L('Passport', 'جواز سفر')} · TechNova</p>
            <p className="text-xl font-bold">{p.student.name}</p>
            {p.student.nameAr && <p className="text-lg" dir="rtl">{p.student.nameAr}</p>}
            <p className="font-mono text-sm">{p.passport.number}</p>
            <p className="text-xs text-white/80">{p.student.reg} · {p.student.campus} · {L('joined', 'انضم')} {day(p.student.joinedAt, ar)}</p>
          </div>
          {qr && (
            <div className="rounded-xl bg-white p-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR" className="h-24 w-24" />
              <p className="text-[10px] text-slate-600">{L('Student card', 'كارت الطالب')}</p>
            </div>
          )}
        </div>
        {family && session?.user?.name && <Watermark text={session.user.name} moving />}
      </div>

      {/* stamps */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{L('Stamps', 'الأختام')} ({p.stamps.length})</CardTitle></CardHeader>
        <CardContent>
          {!p.stamps.length ? <p className="text-sm text-slate-500">{L('No stamps yet — the first one comes soon!', 'لسه مفيش أختام — أول ختم جاي قريب!')}</p> : (
            <div className="relative grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {p.stamps.map((s) => (
                <div key={s.id} className="flex flex-col items-center gap-1 text-center">
                  <StampBadge stamp={{ ...s, date: s.awardedAt }} ar={ar} size={130} isNew={s.isNew} />
                  {s.note && <p className="text-[11px] text-slate-500">{s.note}</p>}
                  {family && <button type="button" onClick={() => shareImage(s)} className="inline-flex items-center gap-1 text-[11px] text-indigo-700 hover:underline"><Share2 className="h-3 w-3" /> {L('Share', 'شارك')}</button>}
                </div>
              ))}
              {family && session?.user?.name && <Watermark text={session.user.name} moving />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* certificates + projects */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{L('Certificates', 'الشهادات')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!p.certificates.length ? <p className="text-slate-500">{L('None yet.', 'لسه مفيش.')}</p> : p.certificates.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                <span><span className="font-medium text-slate-800">{c.title}</span> <span className="text-xs text-slate-400">· {day(c.issuedAt, ar)}</span></span>
                {c.number ? <Link href={`/verify/${c.number}`} target="_blank" className="font-mono text-xs text-indigo-700 hover:underline">{c.number}</Link> : <span className="text-xs text-amber-700">{L('earned — shown at the ceremony', 'اتكسبت — هتظهر في الحفلة')}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{L('Projects in the gallery', 'مشاريع في المعرض')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {!p.projects.length ? <p className="text-slate-500">{L('None yet.', 'لسه مفيش.')}</p> : p.projects.map((x) => <span key={x.id} className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs text-orange-800">🖼️ {ar ? x.titleAr : x.titleEn}</span>)}
          </CardContent>
        </Card>
      </div>

      {/* parent: share links */}
      {p.viewer === 'PARENT' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Share2 className="h-4 w-4" /> {L('Share the passport', 'شارك الجواز')}</CardTitle>
            <CardDescription>{L(`A link for a school or family, open for ${p.shareDays} days; you can stop it any time. It never shows phone numbers, money, grades or attendance.`, `لينك لمدرسة أو للعيلة، مفتوح ${p.shareDays} يوم وتقدر توقفه في أي وقت. عمره ما بيظهر فيه أرقام تليفونات ولا فلوس ولا درجات ولا حضور.`)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={showProjects} onChange={(e) => setShowProjects(e.target.checked)} /> {L('Show the projects', 'اظهر المشاريع')}</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /> {L('Show the photo', 'اظهر الصورة')}</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showSkills} onChange={(e) => setShowSkills(e.target.checked)} /> {L('Show the skills', 'اظهر المهارات')}</label>
              <Button size="sm" disabled={share.isPending} onClick={() => share.mutate()}>{L('Make a link', 'اعمل لينك')}</Button>
            </div>
            {p.shares.map((s) => {
              const url = `${base}/passport/share/${s.token}`
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-2 text-xs">
                  <Input readOnly value={url} className="h-8 flex-1 font-mono text-xs" />
                  <span className="text-slate-500">{L('until', 'لحد')} {day(s.expiresAt, ar)} · {s.views} {L('views', 'مشاهدة')}</span>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(url).then(() => notify.success(L('Copied', 'اتنسخ'))) }}><Copy className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => stop.mutate(s.id)}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* staff: give a stamp, print */}
      {p.canManage && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{L('Staff', 'للموظفين')}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {p.manualStamps.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={giveId} onValueChange={setGiveId}><SelectTrigger className="h-9 w-64"><SelectValue placeholder={L('Give a stamp', 'حط ختم')} /></SelectTrigger><SelectContent>{p.manualStamps.map((s) => <SelectItem key={s.id} value={s.id}>{s.icon} {ar ? s.nameAr || s.nameEn : s.nameEn}</SelectItem>)}</SelectContent></Select>
                <Input className="h-9 w-64" placeholder={L('Note (optional)', 'ملاحظة (اختياري)')} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" disabled={!giveId || give.isPending} onClick={() => give.mutate()}>{L('Give', 'حط')}</Button>
              </div>
            )}
            {p.canPrint && (
              <div className="flex flex-wrap items-center gap-2">
                {(['BOOKLET', 'PASSPORT_PDF', 'TRANSCRIPT'] as const).map((k) => (
                  <Button key={k} asChild size="sm" variant="outline" className="gap-1">
                    <Link href={`/passport/print/${p.student.id}?kind=${k}`} target="_blank"><Printer className="h-4 w-4" /> {k === 'BOOKLET' ? L('Paper passport (A6)', 'الجواز الورقي (A6)') : k === 'PASSPORT_PDF' ? L('Passport PDF', 'الجواز PDF') : L('Transcript', 'كشف الدرجات')}</Link>
                  </Button>
                ))}
                {p.bookletPrice != null && <span className="text-xs text-slate-500">{L('Booklet price', 'سعر الكتيّب')}: {p.bookletPrice}</span>}
              </div>
            )}
            {p.prints.length > 0 && <p className="text-xs text-slate-500">{L('Printed', 'اتطبع')}: {p.prints.map((x) => `${x.kind} #${x.copyNo} (${day(x.at, ar)})`).join(' · ')}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
