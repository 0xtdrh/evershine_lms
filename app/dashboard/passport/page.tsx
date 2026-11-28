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
import { BookStats, DataPage, PAPER, PassportCover, TripsPage, VisasPage, type BookFields, type Look, type Trip, type Visa } from '@/components/passport/PassportBook'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookMarked, Copy, Loader2, Lock, Printer, Share2, Trash2, X } from 'lucide-react'

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
  // owner 28/11
  locked: { id: string; nameEn: string; nameAr: string; icon: string; shape: string; color: string; kind: string }[]
  secretLeft: number; total: number
  next: { id: string; nameEn: string; nameAr: string; icon: string; have: number; need: number } | null
  classmates: { id: string; name: string }[]
  giverNames: Record<string, string>
  // S49
  book: (BookFields & { trips: Trip[]; visas: Visa[]; young: boolean }) | null
  look: Look
  edition: { edition: number; onThisBook: number; perBook: number; justRenewed: boolean }
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
  // owner 28/11: a new stamp lands with a short buzz on phones (once per page open)
  useEffect(() => {
    if (p?.stamps.some((s) => s.isNew)) { try { navigator.vibrate?.([30, 50, 80]) } catch { /* not supported */ } }
  }, [p?.passport.number]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // owner 28/11: one stamp to many students of the same group (this student is ticked first)
  const [giveTo, setGiveTo] = useState<string[]>([])
  useEffect(() => { setGiveTo(studentId ? [studentId] : []) }, [studentId])
  const give = useMutation({
    mutationFn: () => fetchApi<{ given: number }>('/api/passport/stamps/give', { method: 'POST', body: JSON.stringify({ stampId: giveId, studentIds: giveTo.length ? giveTo : [studentId], note: note || null }) }),
    onSuccess: (r) => { notify.success(r.given ? L(`Stamp given to ${r.given}`, `الختم اتحط لـ ${r.given}`) : L('They already have this stamp', 'معاهم الختم ده')); setNote(''); refresh() }, onError: (e: Error) => notify.error(e.message),
  })
  // owner 28/11: tap a stamp → its story in a sheet
  const [open, setOpen] = useState<Stamp | null>(null)
  // S49: the cover opens once per visit; inside pages
  const [opened, setOpened] = useState(false)
  const [opening, setOpening] = useState(false)
  const [page, setPage] = useState<'stamps' | 'trips' | 'visas'>('stamps')
  useEffect(() => { try { setOpened(!!studentId && sessionStorage.getItem(`tn_pass_open_${studentId}`) === '1') } catch { setOpened(true) } }, [studentId])

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
  const firstName = p.student.name.split(' ')[0]
  const oldCount = (p.edition.edition - 1) * p.edition.perBook
  const oldStamps = p.stamps.slice(0, oldCount)
  const bookStamps = p.stamps.slice(oldCount)
  const base = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookMarked className="h-7 w-7 text-indigo-600" /> {p.viewer === 'STUDENT' ? L('My TechNova passport', 'جوازي في TechNova') : L(`${firstName}'s passport`, `جواز ${firstName}`)}</h1>
        <Link href={`/dashboard/profile${staffStudent ? `?s=${studentId}` : ''}`} className="text-sm text-indigo-700 hover:underline">👤 {L('Profile', 'البروفايل')} →</Link>
        {!staffStudent && (mine?.length ?? 0) > 1 && (
          <Select value={studentId} onValueChange={setPick}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger><SelectContent>{mine!.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
        )}
      </div>

      {/* owner 28/11 (S49): the real passport — the cover opens like a book (once per visit), then the data page */}
      {!opened ? (
        <PassportCover look={p.look} ar={ar} number={p.passport.number} edition={p.edition.edition} young={!!p.book?.young} color={p.cover} opening={opening}
          onOpen={() => { setOpening(true); setTimeout(() => { setOpened(true); setOpening(false); try { sessionStorage.setItem(`tn_pass_open_${studentId}`, '1') } catch { /* private mode */ } }, 650) }} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-3 animate-in fade-in zoom-in-95 duration-500">
          {p.edition.justRenewed && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-900">🎉 {L(`A new passport! The old one is full — this is passport no. ${p.edition.edition}.`, `جواز جديد! القديم اتملى — ده الجواز رقم ${p.edition.edition}.`)}</div>
          )}
          <DataPage look={p.look} ar={ar} name={p.student.name} nameAr={p.student.nameAr} number={p.passport.number} edition={p.edition.edition} reg={p.student.reg}
            joinedAt={p.student.joinedAt} photo={p.student.photo} qr={qr || undefined} book={p.book} />
          <BookStats book={p.book} stamps={p.stamps.length} />
          <button type="button" className="mx-auto block text-xs text-slate-500 hover:underline" onClick={() => { setOpened(false); try { sessionStorage.removeItem(`tn_pass_open_${studentId}`) } catch { /* private mode */ } }}>📕 {L('Close the passport', 'اقفل الجواز')}</button>
        </div>
      )}

      {/* the inside pages: stamps / my trips / visas */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="tablist">
        {([['stamps', L('Stamps', 'الأختام'), '🛂'], ['trips', L('My trips', 'رحلاتي'), '✈️'], ['visas', L('Visas', 'التأشيرات'), '🌍']] as const).map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={page === k} onClick={() => setPage(k)} className={`min-h-10 flex-1 rounded-lg px-2 font-medium transition ${page === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`}>{icon} {label}</button>
        ))}
      </div>
      {page === 'trips' && <Card><CardContent className="pt-5"><TripsPage trips={p.book?.trips ?? []} ar={ar} /></CardContent></Card>}
      {page === 'visas' && <VisasPage visas={p.book?.visas ?? []} ar={ar} name={ar && p.student.nameAr ? p.student.nameAr : p.student.name} />}

      {/* stamps */}
      {page === 'stamps' && <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>{L('Stamps', 'الأختام')}{p.edition.edition > 1 ? ` · ${L(`passport ${p.edition.edition}`, `الجواز ${p.edition.edition}`)}` : ''}</span>
            <span className="text-sm font-medium text-indigo-700">{L(`${p.stamps.length} of ${p.total}`, `${p.stamps.length} من ${p.total}`)}</span>
          </CardTitle>
          {/* owner 28/11: the stamp closest to being earned */}
          {p.next && (
            <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
              <p className="text-sm font-semibold text-indigo-900">{p.next.icon} {L('Next stamp', 'الختم الجاي')}: {ar ? p.next.nameAr : p.next.nameEn}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-2 rounded-full bg-indigo-500 transition-all duration-700" style={{ width: `${Math.round((p.next.have / p.next.need) * 100)}%` }} /></div>
              <p className="mt-1 text-xs text-indigo-700">{L(`${p.next.need - p.next.have} to go (${p.next.have} of ${p.next.need})`, `فاضل ${p.next.need - p.next.have} (${p.next.have} من ${p.next.need})`)}</p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!p.stamps.length && !p.locked.length ? <p className="text-sm text-slate-500">{L('No stamps yet — the first one comes soon!', 'لسه مفيش أختام — أول ختم جاي قريب!')}</p> : (
            <div className={`relative grid gap-3 ${p.book?.young ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6'}`} style={PAPER}>
              {bookStamps.map((s) => (
                <button key={s.id} type="button" onClick={() => setOpen(s)} className="flex flex-col items-center gap-1 rounded-xl p-1 text-center transition active:scale-95" aria-label={ar ? s.nameAr : s.nameEn}>
                  <StampBadge stamp={{ ...s, date: s.awardedAt }} ar={ar} fluid isNew={s.isNew} />
                  {s.isNew && <span className="rounded-full bg-amber-100 px-2 text-[10px] font-bold text-amber-800">{L('New', 'جديد')}</span>}
                </button>
              ))}
              {/* owner 28/11: what is still to win — faded with a lock; secret ones only as «?» */}
              {p.locked.slice(0, 6).map((s) => (
                <div key={s.id} className="relative flex flex-col items-center gap-1 p-1 text-center" title={ar ? s.nameAr : s.nameEn}>
                  <StampBadge stamp={{ ...s, label: null, date: null }} ar={ar} fluid faded />
                  <Lock className="absolute top-1/3 h-5 w-5 text-slate-500" aria-hidden />
                </div>
              ))}
              {p.locked.length > 6 && (
                <div className="col-span-full text-center text-xs font-semibold text-indigo-700">{L(`+ ${p.locked.length - 6} more stamps waiting for you`, `+ ${p.locked.length - 6} ختم كمان مستنيك`)}</div>
              )}
              {Array.from({ length: Math.min(p.secretLeft, 3) }).map((_, i) => (
                <div key={`secret-${i}`} className="flex aspect-square items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-2xl font-bold text-slate-400" title={L('Secret stamp', 'ختم سرّي')}>?</div>
              ))}
              {family && session?.user?.name && <Watermark text={session.user.name} moving />}
            </div>
          )}
          {/* renewal: the stamps of the full (old) passports stay here */}
          {oldStamps.length > 0 && (
            <details className="mt-4 rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">📚 {L(`Old passports (${oldStamps.length} stamps)`, `الجوازات القديمة (${oldStamps.length} ختم)`)}</summary>
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">{oldStamps.map((s) => <button key={s.id} type="button" onClick={() => setOpen(s)}><StampBadge stamp={{ ...s, date: s.awardedAt }} ar={ar} fluid /></button>)}</div>
            </details>
          )}
        </CardContent>
      </Card>}

      {/* owner 28/11: a stamp's story (bottom sheet on a phone) */}
      {open && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-900/50 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-6 duration-200 sm:rounded-2xl">
            <div className="flex justify-end"><button type="button" onClick={() => setOpen(null)} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label={L('Close', 'اقفل')}><X className="h-5 w-5" /></button></div>
            <div className="mx-auto w-40"><StampBadge stamp={{ ...open, date: open.awardedAt }} ar={ar} fluid /></div>
            <p className="mt-3 text-center text-lg font-bold text-slate-900">{open.icon} {ar ? open.nameAr : open.nameEn}{open.label ? ` · ${open.label}` : ''}</p>
            <p className="text-center text-sm text-slate-500">{day(open.awardedAt, ar)} · {open.source === 'AUTO' ? L('earned by itself', 'اتكسب لوحده') : open.source === 'EVENT' ? L('at an event', 'في فعالية') : L('given by hand', 'اتدّى بالإيد')}{p.giverNames[open.id] ? ` · ${p.giverNames[open.id]}` : ''}</p>
            {open.note && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">“{open.note}”</p>}
            {family && <Button className="mt-4 min-h-11 w-full gap-2" onClick={() => shareImage(open)}><Share2 className="h-4 w-4" /> {L('Share the stamp', 'شارك الختم')}</Button>}
          </div>
        </div>
      )}

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
                <Button size="sm" disabled={!giveId || give.isPending} onClick={() => give.mutate()}>{L('Give', 'حط')}{giveTo.length > 1 ? ` (${giveTo.length})` : ''}</Button>
              </div>
            )}
            {p.manualStamps.length > 0 && p.classmates.length > 1 && (
              <details className="rounded-lg border border-slate-200 p-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">{L('Give it to more students of the group', 'حطه لطلاب تانيين في الجروب')} ({giveTo.length})</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded-full border px-2 py-1 text-xs" onClick={() => setGiveTo(giveTo.length === p.classmates.length ? [studentId] : p.classmates.map((c) => c.id))}>{giveTo.length === p.classmates.length ? L('Only this student', 'الطالب ده بس') : L('Whole group', 'كل الجروب')}</button>
                  {p.classmates.map((c) => (
                    <label key={c.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
                      <input type="checkbox" checked={giveTo.includes(c.id)} onChange={(e) => setGiveTo(e.target.checked ? [...giveTo, c.id] : giveTo.filter((x) => x !== c.id))} /> {c.name}
                    </label>
                  ))}
                </div>
              </details>
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
