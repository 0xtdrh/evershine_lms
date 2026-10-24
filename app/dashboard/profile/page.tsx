'use client'

/**
 * P2: the student's profile — TechNova map + next step, goals, skills, projects, "first times" album, instructor
 * quotes, inventor's diary, thank-you notes, experience, yearly recap, portfolio. Student own / parent (child picker) /
 * staff ?s=<studentId>.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { uploadProfileMedia } from '@/components/profile/uploadProfileMedia'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Camera, Loader2, MapPin, Printer, Sparkles, Trash2, UserRound } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

type Media = { url: string; type: 'image' | 'video' } | null
interface Station { id: string; name: string; state: 'DONE' | 'CURRENT' | 'NEXT' | 'LATER' }
interface Profile {
  viewer: string; age: number; older: boolean
  student: { id: string; name: string; photo: string | null; campus: string; joinedAt: string }
  can: { goal: boolean; upload: boolean; diary: boolean; thank: boolean; moment: boolean; experience: boolean; portfolio: boolean; interest: boolean }
  map: { next: { levelId: string; label: string; reason: string } | null; islands: { id: string; name: string; ageFits: boolean; courses: { id: string; name: string; levels: Station[] }[] }[] }
  goals: { id: string; title: string; kind: string; metric: string | null; value: number; target: number; percent: number; done: boolean; createdByRole: string }[]
  skills: { course: string; scores: { id: string; nameEn: string; nameAr: string; percent: number | null }[]; strong: { nameEn: string; nameAr: string }[]; weak: { nameEn: string; nameAr: string }[] }[]
  projects: { id: string; source: string; titleEn: string; titleAr: string; status: string; media: Media; description?: string | null }[]
  moments: { id: string; title: string; note: string | null; takenAt: string; media: Media }[]
  quotes: { text: string; date: string }[]
  diary: { id: string; text: string; at: string }[]
  thanks: { id: string; from: string; text: string; at: string }[]
  myThanks: { id: string; text: string; status: string }[]
  classmates: { id: string; name: string }[]
  experience: { id: string; role: string; titleEn: string | null; titleAr: string | null; from: string; to: string | null }[]
  recap: { years: number } | null
  activeGroups: { id: string; label: string }[]
}

// goal types: the number is typed in the box next to it (2026-10-24: no more "N" in the labels)
const METRICS: Record<string, [string, string]> = { SESSIONS: ['Attend a number of sessions', 'أحضر عدد من الحصص'], STAMPS: ['Collect a number of stamps', 'أجمع عدد من الأختام'], HOMEWORK: ['Hand in a number of homework', 'أسلّم عدد من الواجبات'], QUIZ90: ['90%+ in a number of quizzes', '90% أو أكتر في عدد من الكويزات'] }
const ROLES: Record<string, [string, string]> = { ASSISTANT: ['Assistant instructor', 'مساعد مدرب'], AMBASSADOR: ['Ambassador', 'سفير'], ALUMNI: ['Alumni', 'خريج'], OTHER: ['Experience', 'خبرة'] }
const day = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function MediaView({ m }: { m: Media }) {
  if (!m) return null
  // eslint-disable-next-line @next/next/no-img-element
  return m.type === 'video' ? <video src={m.url} controls className="h-36 w-full rounded-lg bg-black object-cover" /> : <img src={m.url} alt="" className="h-36 w-full rounded-lg object-cover" />
}

export default function ProfilePage() {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const sp = useSearchParams()
  const staffStudent = sp.get('s')
  const { data: mine } = useQuery({ queryKey: ['passport-me'], queryFn: () => fetchApi<{ id: string; name: string }[]>('/api/passport/me'), enabled: !staffStudent })
  const [pick, setPick] = useState('')
  const studentId = staffStudent || pick || mine?.[0]?.id || ''
  const key = ['profile', studentId]
  const { data: p, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<Profile>(`/api/profile/${studentId}`), enabled: !!studentId, retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchApi(`/api/profile/${studentId}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() }, onError: (e: Error) => notify.error(e.message),
  })
  const item = useMutation({
    mutationFn: (x: { method: 'PATCH' | 'DELETE'; body?: Record<string, unknown>; query?: string }) => fetchApi(`/api/profile/items${x.query ?? ''}`, { method: x.method, ...(x.body ? { body: JSON.stringify(x.body) } : {}) }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  // forms
  const [goal, setGoal] = useState({ title: '', kind: 'SYSTEM', metric: 'SESSIONS', target: 10 })
  const [diary, setDiary] = useState('')
  const [thanks, setThanks] = useState({ to: '', text: '' })
  const [up, setUp] = useState({ title: '', busy: false })
  const [moment, setMoment] = useState({ title: '', note: '', busy: false })
  const [exp, setExp] = useState({ role: 'ASSISTANT', titleEn: '', from: '' })

  const pickFile = (accept: string, onFile: (f: File) => void) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => { const f = i.files?.[0]; if (f) onFile(f) }; i.click() }
  const uploadProject = () => pickFile('image/*,video/*', async (f) => {
    setUp((x) => ({ ...x, busy: true }))
    try { const media = await uploadProfileMedia(studentId, f); await act.mutateAsync({ action: 'upload', title: up.title || f.name.slice(0, 80), media }); setUp({ title: '', busy: false }) } catch (e) { notify.error((e as Error).message); setUp((x) => ({ ...x, busy: false })) }
  })
  const addMoment = (withPhoto: boolean) => {
    const go = async (media: unknown) => { await act.mutateAsync({ action: 'moment', title: moment.title, note: moment.note || null, media }); setMoment({ title: '', note: '', busy: false }) }
    if (!withPhoto) return go(null)
    pickFile('image/*,video/*', async (f) => { setMoment((x) => ({ ...x, busy: true })); try { await go(await uploadProfileMedia(studentId, f, true)) } catch (e) { notify.error((e as Error).message); setMoment((x) => ({ ...x, busy: false })) } })
  }

  if (!studentId) return mine && !mine.length ? <p className="text-sm text-slate-500">{L('No profile here.', 'مفيش بروفايل هنا.')}</p> : <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error) return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (isLoading || !p) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const name = (k: { nameEn: string; nameAr: string }) => (ar && k.nameAr) || k.nameEn
  const stationCls: Record<string, string> = { DONE: 'bg-emerald-500 text-white border-emerald-500', CURRENT: 'bg-indigo-600 text-white border-indigo-600 ring-4 ring-indigo-200', NEXT: 'bg-amber-100 text-amber-800 border-amber-400 border-dashed', LATER: 'bg-white text-slate-400 border-slate-200' }

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><UserRound className="h-7 w-7 text-indigo-600" /> {p.student.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {!staffStudent && (mine?.length ?? 0) > 1 && <Select value={studentId} onValueChange={setPick}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger><SelectContent>{mine!.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>}
          <Button asChild size="sm" variant="outline"><Link href={`/dashboard/passport${staffStudent ? `?s=${studentId}` : ''}`}>📘 {L('Passport', 'الجواز')}</Link></Button>
          {p.can.portfolio && <Button asChild size="sm" variant="outline" className="gap-1"><Link href={`/profile/portfolio/${studentId}`} target="_blank"><Printer className="h-4 w-4" /> {L('Portfolio PDF', 'ملف Portfolio')}</Link></Button>}
        </div>
      </div>

      {p.recap && (
        <Link href={`/dashboard/profile/recap?s=${studentId}`} className="flex items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-indigo-600 p-4 text-white">
          <span className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" /> {L(`${p.recap.years} year(s) at TechNova — see the year in numbers!`, `${p.recap.years} سنة في TechNova — شوف السنة بالأرقام!`)}</span><span>→</span>
        </Link>
      )}

      {/* map */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-indigo-600" /> {L('TechNova map', 'خريطة TechNova')}</CardTitle>
          {p.map.next && <CardDescription>{L('Next stop', 'المحطة الجاية')}: <b>{p.map.next.label}</b>{p.map.next.reason === 'NEW_TRACK' ? L(' (fits the age)', ' (مناسبة للسن)') : ''}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3">
          {!p.map.islands.length && <p className="text-sm text-slate-500">{L('The map fills in once the student joins a group.', 'الخريطة بتتملا أول ما الطالب يدخل جروب.')}</p>}
          {p.map.islands.filter((i) => i.courses.some((c) => c.levels.length)).map((isl) => (
            <div key={isl.id} className={`rounded-2xl border p-3 ${isl.ageFits ? 'border-sky-200 bg-sky-50/50' : 'border-slate-100 bg-slate-50/50 opacity-70'}`}>
              <p className="mb-2 text-sm font-bold text-slate-700">🏝️ {isl.name}</p>
              <div className="space-y-2">
                {isl.courses.filter((c) => c.levels.length).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-1">
                    <span className="w-32 shrink-0 truncate text-xs text-slate-500">{c.name}</span>
                    {c.levels.map((l, i) => (
                      <span key={l.id} className="flex items-center gap-1">
                        {i > 0 && <span className={`h-0.5 w-4 ${l.state === 'DONE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                        <span title={l.name} className={`flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-[11px] font-semibold ${stationCls[l.state]}`}>{l.state === 'CURRENT' ? '📍' : l.state === 'DONE' ? '✓' : ''} {l.name}</span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {p.can.interest && p.map.next && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'interest', levelId: p.map.next!.levelId })}>{L(`Book ${p.map.next.label}`, `احجز ${p.map.next.label}`)}</Button>}
        </CardContent>
      </Card>

      {/* goals */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">🎯 {L('Goals', 'الأهداف')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {p.goals.map((g) => (
            <div key={g.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{g.done ? '✅ ' : ''}{g.title}</span><span className="flex items-center gap-2 text-xs text-slate-500">{g.kind === 'SYSTEM' ? `${g.value} / ${g.target}` : `${g.percent}%`}<button type="button" onClick={() => item.mutate({ method: 'DELETE', query: `?type=goal&id=${g.id}` })}><Trash2 className="h-3 w-3 text-slate-400" /></button></span></div>
              <div className="h-2 rounded bg-slate-100"><div className={`h-2 rounded ${g.done ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${g.percent}%` }} /></div>
              {g.kind === 'FREE' && !g.done && <input type="range" min={0} max={100} step={10} defaultValue={g.percent} className="w-full" onMouseUp={(e) => item.mutate({ method: 'PATCH', body: { type: 'goal', id: g.id, progress: Number((e.target as HTMLInputElement).value) } })} onTouchEnd={(e) => item.mutate({ method: 'PATCH', body: { type: 'goal', id: g.id, progress: Number((e.target as HTMLInputElement).value) } })} />}
            </div>
          ))}
          {p.can.goal && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Input className="h-9 w-56" placeholder={L('Goal', 'الهدف')} value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} />
              <Select value={goal.kind === 'FREE' ? 'FREE' : goal.metric} onValueChange={(v) => setGoal(v === 'FREE' ? { ...goal, kind: 'FREE' } : { ...goal, kind: 'SYSTEM', metric: v })}>
                <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(METRICS).map(([k, v]) => <SelectItem key={k} value={k}>{ar ? v[1] : v[0]}</SelectItem>)}<SelectItem value="FREE">{L('My own goal (I move the bar)', 'هدف خاص (أنا أحرّك الشريط)')}</SelectItem></SelectContent>
              </Select>
              {goal.kind === 'SYSTEM' && <label className="flex items-center gap-1 text-xs">{L('Number', 'العدد')} <Input type="number" min={1} className="h-9 w-20" value={goal.target} onChange={(e) => setGoal({ ...goal, target: Number(e.target.value) || 1 })} /></label>}
              <Button size="sm" disabled={!goal.title.trim() || act.isPending} onClick={() => act.mutate({ action: 'goal', title: goal.title, kind: goal.kind, metric: goal.kind === 'SYSTEM' ? goal.metric : null, target: goal.kind === 'SYSTEM' ? goal.target : null })}>{L('Add goal', 'ضيف هدف')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* skills */}
      {p.skills.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">💪 {L('Skills', 'المهارات')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {p.skills.map((s) => (
              <div key={s.course} className="space-y-1 text-xs">
                <p className="font-semibold text-slate-700">{s.course}</p>
                {s.scores.filter((k) => k.percent != null).map((k) => (
                  <div key={k.id} className="flex items-center gap-2"><span className="w-28 truncate">{name(k)}</span><div className="h-2 flex-1 rounded bg-slate-100"><div className={`h-2 rounded ${k.percent! >= 75 ? 'bg-emerald-500' : k.percent! >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}`} style={{ width: `${k.percent}%` }} /></div><span className="w-10 text-end">{k.percent}%</span></div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* projects */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">🖼️ {L('Projects', 'المشاريع')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {p.projects.map((x) => (
              <div key={x.id} className={`space-y-1 rounded-xl border p-2 text-xs ${x.status === 'PENDING' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-100'}`}>
                <MediaView m={x.media} />
                <p className="font-medium text-slate-800">{ar ? x.titleAr : x.titleEn}</p>
                {x.status === 'PENDING' && <p className="text-amber-700">{L('waiting for the instructor', 'مستني موافقة المدرب')}</p>}
              </div>
            ))}
          </div>
          {!p.projects.length && <p className="text-sm text-slate-500">{L('No projects yet.', 'لسه مفيش مشاريع.')}</p>}
          {p.can.upload && (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-64" placeholder={L('Project name', 'اسم المشروع')} value={up.title} onChange={(e) => setUp({ ...up, title: e.target.value })} />
              <Button size="sm" variant="outline" className="gap-1" disabled={up.busy} onClick={uploadProject}>{up.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {L('Upload photo / video (1 min)', 'ارفع صورة / فيديو (دقيقة)')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* album */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">📸 {L('First times', 'أول مرة')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {p.moments.map((m) => (
              <div key={m.id} className="space-y-1 rounded-xl border border-slate-100 p-2 text-xs"><MediaView m={m.media} /><p className="font-semibold text-slate-800">{m.title}</p>{m.note && <p className="text-slate-500">{m.note}</p>}<p className="text-slate-400">{day(m.takenAt, ar)}</p></div>
            ))}
          </div>
          {!p.moments.length && <p className="text-sm text-slate-500">{L('The first robot that moves will be here!', 'أول روبوت هيتحرك هيبقى هنا!')}</p>}
          {p.can.moment && (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-56" placeholder={L('e.g. First robot that moved', 'مثلًا: أول روبوت اتحرك')} value={moment.title} onChange={(e) => setMoment({ ...moment, title: e.target.value })} />
              <Input className="h-9 w-56" placeholder={L('Note (optional)', 'ملاحظة (اختياري)')} value={moment.note} onChange={(e) => setMoment({ ...moment, note: e.target.value })} />
              <Button size="sm" variant="outline" className="gap-1" disabled={!moment.title.trim() || moment.busy} onClick={() => addMoment(true)}>{moment.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {L('With photo', 'بصورة')}</Button>
              <Button size="sm" variant="ghost" disabled={!moment.title.trim()} onClick={() => addMoment(false)}>{L('Without photo', 'من غير صورة')}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* quotes */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">💬 {L('What the instructors say', 'المدربين بيقولوا')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{p.quotes.length ? p.quotes.map((q, i) => <p key={i} className="rounded-lg bg-slate-50 p-2">“{q.text}” <span className="text-xs text-slate-400">— {day(q.date, ar)}</span></p>) : <p className="text-slate-500">—</p>}</CardContent>
        </Card>
        {/* thanks */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">🤝 {L('Thank-you notes', 'رسايل شكر')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.thanks.map((t) => <p key={t.id} className="rounded-lg bg-emerald-50 p-2">“{t.text}” <span className="text-xs text-slate-500">— {t.from}</span></p>)}
            {!p.thanks.length && <p className="text-slate-500">—</p>}
            {p.can.thank && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <Select value={thanks.to} onValueChange={(v) => setThanks({ ...thanks, to: v })}><SelectTrigger className="h-9 w-40"><SelectValue placeholder={L('Classmate', 'زميل')} /></SelectTrigger><SelectContent>{p.classmates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
                <Input className="h-9 flex-1" maxLength={300} placeholder={L('Thank you for…', 'شكرًا علشان…')} value={thanks.text} onChange={(e) => setThanks({ ...thanks, text: e.target.value })} />
                <Button size="sm" disabled={!thanks.to || !thanks.text.trim()} onClick={() => { act.mutate({ action: 'thanks', toStudentId: thanks.to, text: thanks.text }); setThanks({ to: '', text: '' }) }}>{L('Send', 'ابعت')}</Button>
                {p.myThanks.some((t) => t.status === 'PENDING') && <p className="w-full text-xs text-amber-700">{L('Your note shows after the instructor approves it.', 'رسالتك هتظهر بعد موافقة المدرب.')}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* diary */}
      {(p.older || p.diary.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">📓 {L("Inventor's diary", 'مذكرات المخترع')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.can.diary && (
              <div className="flex gap-2"><Input maxLength={500} placeholder={L('Today I learned… / It was hard…', 'النهارده اتعلمت… / كان صعب…')} value={diary} onChange={(e) => setDiary(e.target.value)} /><Button size="sm" disabled={!diary.trim()} onClick={() => { act.mutate({ action: 'diary', text: diary }); setDiary('') }}>{L('Write', 'اكتب')}</Button></div>
            )}
            {p.diary.map((d) => <p key={d.id} className="rounded-lg bg-slate-50 p-2">{d.text} <span className="text-xs text-slate-400">— {day(d.at, ar)}</span></p>)}
          </CardContent>
        </Card>
      )}

      {/* experience */}
      {(p.experience.length > 0 || p.can.experience) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">🏅 {L('Experience', 'الخبرة')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.experience.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2"><span><b>{ar ? ROLES[e.role]?.[1] : ROLES[e.role]?.[0]}</b>{e.titleEn ? ` · ${ar && e.titleAr ? e.titleAr : e.titleEn}` : ''} <span className="text-xs text-slate-400">{day(e.from, ar)}{e.to ? ` → ${day(e.to, ar)}` : ''}</span></span>
                {p.can.experience && <button type="button" onClick={() => item.mutate({ method: 'DELETE', query: `?type=experience&id=${e.id}` })}><Trash2 className="h-3 w-3 text-slate-400" /></button>}</div>
            ))}
            {p.can.experience && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                <Select value={exp.role} onValueChange={(v) => setExp({ ...exp, role: v })}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLES).map(([k, v]) => <SelectItem key={k} value={k}>{ar ? v[1] : v[0]}</SelectItem>)}</SelectContent></Select>
                <Input className="h-9 w-48" placeholder={L('Details (optional)', 'تفاصيل (اختياري)')} value={exp.titleEn} onChange={(e) => setExp({ ...exp, titleEn: e.target.value })} />
                <DateInput className="h-9 w-40" value={exp.from} onChange={(e) => setExp({ ...exp, from: e.target.value })} />
                <Button size="sm" disabled={!exp.from} onClick={() => { act.mutate({ action: 'experience', role: exp.role, titleEn: exp.titleEn || null, from: exp.from }); setExp({ role: 'ASSISTANT', titleEn: '', from: '' }) }}>{L('Add', 'ضيف')}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
