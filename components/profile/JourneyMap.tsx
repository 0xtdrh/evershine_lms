'use client'

/**
 * The inventor's journey (2026-11-10, owner): every track is an island, every level a station on a winding path,
 * the student's robot stands on the current one, finished stations are gold with their stars, the graduation tower
 * ends each island and tracks not started yet wait in the fog. A station opens a sheet with its details.
 * The picture keeps its own colours in dark mode (keep-light).
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Lock, X } from 'lucide-react'

export interface JourneyLevel {
  levelId: string; course: string; name: string; state: 'DONE' | 'CURRENT' | 'NEXT' | 'LATER'; stars: number; finalScore: number | null
  attendancePct: number | null; homework: { handed: number; set: number }; quizPct: number | null; projects: number
  certificate: 'READY' | 'EARNED' | null; startedAt: string; endedAt: string; teacher: string | null
  left: { sessions: number; homework: number; finalResult: boolean } | null; plan: { sessions: number; months: number }
}
export interface Journey {
  title: { en: string; ar: string }; stars: number; levelsDone: number; levels: JourneyLevel[]
  timeline: { at: string; kind: string; en: string; ar: string }[]
  discover: { id: string; name: string; firstLevelId: string | null; courses: string[]; levels: number; ages: (number | null)[] }[]
  lastReport: { id: string; date: string } | null
}
export type MapLook = 'YOUNG' | 'MIDDLE' | 'OLDER'
interface Island { id: string; name: string; courses: { id: string; name: string; levels: { id: string; name: string; state: string }[] }[] }

const PALETTE = ['#2FA37C', '#3F7FD0', '#C8642F', '#8B5CC6', '#C9A227', '#D04F7A']
/** Older students get calmer, deeper colours. */
const CALM = ['#2E6F5E', '#33598A', '#7A4E36', '#5B4A82', '#7A6A2E', '#7E3F57']
/** Sizes per look: young = big stations and bigger names; older = smaller, quieter. */
const SIZE: Record<MapLook, { s: number; row: number; robot: number; name: string; nameW: number }> = {
  YOUNG: { s: 76, row: 132, robot: 50, name: 'text-sm', nameW: 130 },
  MIDDLE: { s: 60, row: 108, robot: 40, name: 'text-xs', nameW: 110 },
  OLDER: { s: 52, row: 96, robot: 34, name: 'text-xs', nameW: 120 },
}
const STATION: Record<string, string> = {
  DONE: 'bg-[#FFC83D] text-[#0C2340] border-white shadow-[0_5px_0_#B98500]',
  CURRENT: 'bg-[#E8503A] text-white border-white shadow-[0_5px_0_#9E2F1D]',
  NEXT: 'bg-white text-[#0C2340] border-[#FFC83D] shadow-[0_5px_0_#B98500]',
  LATER: 'bg-[#B9C6D8] text-[#3B4C63] border-[#E3EAF3] shadow-[0_5px_0_#7D8DA3]',
}
const STATE_TEXT: Record<string, [string, string]> = { DONE: ['Finished', 'خلصت'], CURRENT: ['You are here', 'إنت هنا دلوقتي'], NEXT: ['Next step', 'الخطوة الجاية'], LATER: ['Later', 'لسه'] }
const day = (d: string, ar: boolean) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '')
const stars = (n: number) => (n ? '★'.repeat(n) + '☆'.repeat(3 - n) : '')

function Robot({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 46 50" aria-hidden="true">
      <path d="M23 50 L14 36 L32 36 Z" fill="#FFC83D" />
      <rect x="5" y="5" width="36" height="33" rx="11" fill="#FFC83D" />
      <rect x="11" y="12" width="24" height="17" rx="6" fill="#102E52" />
      <circle cx="18" cy="20" r="2.8" fill="#6EE7D8" /><circle cx="28" cy="20" r="2.8" fill="#6EE7D8" />
    </svg>
  )
}

/** One island: stations zig-zag down a dotted path; the tower closes it. */
function IslandView({ island, color, details, onPick, look }: { island: Island; color: string; details: Map<string, JourneyLevel>; look: MapLook; onPick: (l: JourneyLevel | { levelId: string; name: string; course: string; state: string }) => void }) {
  const stops = island.courses.flatMap((c) => c.levels.map((l, i) => ({ ...l, course: c.name, firstOfCourse: i === 0, n: i + 1 })))
  const z = SIZE[look]
  const half = z.s / 2, ROW = z.row, top = 70 + Math.max(0, half - 30)
  const xs = [50, 76, 50, 24]
  const GAP = 40 // room for the course name where a new course starts
  let extra = 0
  const pts = stops.map((s, i) => { if (s.firstOfCourse) extra += GAP; return { x: xs[i % 4], y: top + i * ROW + extra } })
  const height = top + stops.length * ROW + extra + 110
  const path = pts.map((p, i) => (i ? `C ${pts[i - 1].x} ${p.y - ROW / 2}, ${p.x} ${pts[i - 1].y + ROW / 2}, ${p.x} ${p.y}` : `M ${p.x} ${p.y}`)).join(' ') + (pts.length ? ` L 50 ${height - 70}` : '')
  return (
    <div className="relative mx-auto w-full max-w-[520px] rounded-[56px] border-[10px] border-[#E9C785] p-0" style={{ background: color, height }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} fill="none" stroke="#F7E7BD" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 14" vectorEffect="non-scaling-stroke" />
      </svg>
      <h3 className="relative pt-4 text-center text-lg font-extrabold text-white [text-shadow:0_2px_0_rgba(0,0,0,.25)]">{island.name}</h3>
      {stops.map((s, i) => s.firstOfCourse && (
        <div key={`c-${s.id}`} className="absolute left-1/2 max-w-[85%] -translate-x-1/2 truncate rounded-full bg-white/90 px-3 py-0.5 text-xs font-bold text-[#0C2340]" style={{ top: pts[i].y - half - GAP + 6 }}>{s.course}</div>
      ))}
      {stops.map((s, i) => {
        const d = details.get(s.id)
        const st = (d?.state ?? s.state) as keyof typeof STATION
        return (
          <div key={s.id} className="absolute -translate-x-1/2 text-center" style={{ left: `${pts[i].x}%`, top: pts[i].y - half }}>
            <div className="relative mx-auto" style={{ width: z.s, height: z.s }}>
              {st === 'CURRENT' && look !== 'OLDER' && <span className="absolute inset-0 rounded-full border-4 border-[#FFC83D] motion-safe:animate-ping" aria-hidden="true" />}
              {st === 'CURRENT' && <span className={`absolute left-1/2 -translate-x-1/2 ${look === 'OLDER' ? '' : 'motion-safe:animate-bounce'}`} style={{ top: -z.robot * 1.2 }}><Robot size={z.robot} /></span>}
              <button type="button" onClick={() => onPick(d ?? { levelId: s.id, name: s.name, course: s.course, state: st })} aria-label={`${s.course} · ${s.name} · ${L(STATE_TEXT[st][0], STATE_TEXT[st][1])}`}
                style={{ width: z.s, height: z.s }}
                className={`relative flex items-center justify-center rounded-full border-4 ${look === 'YOUNG' ? 'text-3xl' : look === 'OLDER' ? 'text-base' : 'text-xl'} font-extrabold transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white ${STATION[st]}`}>
                {st === 'DONE' ? (look === 'YOUNG' ? '⭐' : '✓') : st === 'LATER' ? <Lock className={look === 'YOUNG' ? 'h-7 w-7' : 'h-5 w-5'} aria-hidden="true" /> : s.n}
              </button>
            </div>
            <div className={`mt-1.5 ${z.name} font-bold leading-tight text-white [text-shadow:0_1px_0_rgba(0,0,0,.35)]`} style={{ maxWidth: z.nameW }}>{s.name}</div>
            {d?.stars ? <div className={`${look === 'YOUNG' ? 'text-lg' : 'text-sm'} tracking-widest text-[#FFE08A]`} aria-label={`${d.stars} / 3`}>{stars(d.stars)}</div> : null}
            {look === 'OLDER' && st === 'DONE' && d?.finalScore != null ? <div className="text-[11px] font-bold text-white/85">{d.finalScore}%</div> : null}
          </div>
        )
      })}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center" title={L('Graduation tower', 'برج التخرج')}>
        <svg width="56" height="72" viewBox="0 0 66 84" role="img" aria-label={L('Graduation tower', 'برج التخرج')}><rect x="20" y="24" width="26" height="54" fill="#EEF3FA" /><rect x="14" y="18" width="38" height="10" fill="#C9D8EC" /><rect x="29" y="60" width="9" height="18" rx="4.5" fill="#102E52" /><line x1="33" y1="18" x2="33" y2="2" stroke="#102E52" strokeWidth="2.4" /><path d="M33 3 L50 8 L33 13 Z" fill="#E8503A" /></svg>
      </div>
    </div>
  )
}

export function JourneyMap({ islands, journey, canBook, onBook, booking, look = 'MIDDLE' }: { islands: Island[]; journey: Journey; canBook: boolean; onBook: (levelId: string) => void; booking: boolean; look?: MapLook }) {
  const [sel, setSel] = useState<null | { kind: 'level'; l: JourneyLevel | { levelId: string; name: string; course: string; state: string } } | { kind: 'fog'; t: Journey['discover'][number] }>(null)
  const ar = useI18n().locale === 'ar'
  const details = new Map(journey.levels.map((l) => [l.levelId, l]))
  useEffect(() => { if (!sel) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [sel])
  const shown = islands.filter((i) => i.courses.some((c) => c.levels.length))
  return (
    <div className="keep-light space-y-6 rounded-3xl bg-[#0C2340] px-3 py-6 sm:px-6">
      {!shown.length && <p className="text-center text-sm text-[#C9D8EC]">{L('The map fills in once the student joins a group.', 'الخريطة بتتملا أول ما الطالب يدخل جروب.')}</p>}
      {shown.map((isl, i) => <IslandView key={isl.id} island={isl} look={look} color={(look === 'OLDER' ? CALM : PALETTE)[i % PALETTE.length]} details={details} onPick={(l) => setSel({ kind: 'level', l })} />)}
      {journey.discover.map((t) => (
        <div key={t.id} className="mx-auto max-w-[420px] rounded-[40px] border-2 border-dashed border-[#7FA5CE] bg-[#102E52] px-4 py-5 text-center text-white">
          <p className="text-lg font-extrabold">{t.name}</p>
          <p className="mb-3 text-sm text-[#C9D8EC]">{L('Not discovered yet. Ready for the adventure?', 'لسه مكتشفتهاش. جاهز للمغامرة؟')}</p>
          <button type="button" onClick={() => setSel({ kind: 'fog', t })} className="min-h-11 rounded-xl bg-[#FFC83D] px-5 text-sm font-bold text-[#0C2340]">{L('Discover it', 'اكتشفها')}</button>
        </div>
      ))}

      {sel && typeof document !== 'undefined' && createPortal(
        <div className="keep-light fixed inset-0 z-50 flex items-end justify-center bg-[#051020]/55 sm:items-center" onClick={() => setSel(null)}>
          <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 text-[#14263F] sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            {sel.kind === 'fog' ? (
              <>
                <Head sub={L('New island', 'جزيرة جديدة')} title={sel.t.name} tag={L('Fits the age', 'مناسبة للسن')} tagCls="text-emerald-700" onClose={() => setSel(null)} />
                <Stats rows={[[L('Levels', 'المستويات'), String(sel.t.levels)], [L('Ages', 'السن'), sel.t.ages[0] != null ? `${sel.t.ages[0]}${sel.t.ages[1] != null ? ` – ${sel.t.ages[1]}` : '+'}` : '—']]} />
                {sel.t.courses.length > 0 && <p className="mt-3 text-sm text-slate-600">{sel.t.courses.join(' · ')}</p>}
                {canBook && sel.t.firstLevelId && <Button className="mt-4 w-full" disabled={booking} onClick={() => onBook(sel.t.firstLevelId!)}>{L('I want to book', 'عايز أحجز')}</Button>}
              </>
            ) : (() => {
              const l = sel.l as JourneyLevel
              const full = 'plan' in l
              const st = l.state as keyof typeof STATE_TEXT
              return (
                <>
                  <Head sub={l.course} title={l.name} tag={L(STATE_TEXT[st][0], STATE_TEXT[st][1])} tagCls={st === 'DONE' ? 'text-emerald-700' : st === 'CURRENT' ? 'text-rose-700' : st === 'NEXT' ? 'text-amber-800' : 'text-slate-500'} onClose={() => setSel(null)} />
                  {full && l.stars > 0 && <p className="mt-1 text-3xl tracking-widest text-[#C98500]" aria-label={`${l.stars} / 3`}>{stars(l.stars)}</p>}
                  {full && (st === 'DONE' || st === 'CURRENT') && (
                    <Stats rows={[
                      [L('Result', 'النتيجة'), l.finalScore != null ? `${l.finalScore}%` : L('Not final yet', 'لسه')],
                      [L('Attendance', 'الحضور'), l.attendancePct != null ? `${l.attendancePct}%` : '—'],
                      [L('Homework', 'الواجبات'), l.homework.set ? `${l.homework.handed} / ${l.homework.set}` : String(l.homework.handed)],
                      [L('Quizzes', 'الكويزات'), l.quizPct != null ? `${l.quizPct}%` : '—'],
                      [L('Projects', 'المشاريع'), String(l.projects)],
                      [L('Certificate', 'الشهادة'), l.certificate === 'READY' ? L('Ready', 'جاهزة') : l.certificate === 'EARNED' ? L('Earned, coming soon', 'استحقها، جاية قريب') : '—'],
                    ]} />
                  )}
                  {full && (l.startedAt || l.teacher) && <p className="mt-3 text-xs text-slate-500">{l.startedAt && `${L('From', 'من')} ${day(l.startedAt, ar)}`}{l.endedAt && ` ${L('to', 'لـ')} ${day(l.endedAt, ar)}`}{l.teacher && ` · ${L('Instructor', 'المدرب')}: ${l.teacher}`}</p>}
                  {full && l.left && (
                    <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm">
                      <p className="font-bold">{L("What's left?", 'ناقصك إيه؟')}</p>
                      {l.left.sessions > 0 && <p>{L(`${l.left.sessions} more session(s)`, `${l.left.sessions} حصة كمان`)}</p>}
                      {l.left.homework > 0 && <p>{L(`${l.left.homework} homework to hand in`, `${l.left.homework} واجب لسه ما اتسلمش`)}</p>}
                      {l.left.finalResult && <p>{L('The final result of the level', 'النتيجة النهائية للمستوى')}</p>}
                    </div>
                  )}
                  {(st === 'NEXT' || st === 'LATER') && (
                    <>
                      {full && <Stats rows={[[L('Sessions', 'الحصص'), String(l.plan.sessions)], [L('Months', 'الشهور'), String(l.plan.months)]]} />}
                      <p className="mt-3 text-sm text-slate-600">{L('A new step on the journey: new skills and a new project.', 'خطوة جديدة في الرحلة: مهارات جديدة ومشروع جديد.')}</p>
                      {canBook && st === 'NEXT' && <Button className="mt-4 w-full" disabled={booking} onClick={() => onBook(l.levelId)}>{L('I want to book', 'عايز أحجز')}</Button>}
                    </>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      , document.body)}
    </div>
  )
}

function Head({ sub, title, tag, tagCls, onClose }: { sub: string; title: string; tag: string; tagCls: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-500">{sub}</p>
        <p className="text-xl font-extrabold leading-tight">{title}</p>
        <p className={`text-sm font-bold ${tagCls}`}>{tag}</p>
      </div>
      <button type="button" aria-label={L('Close', 'قفل')} onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"><X className="h-4 w-4" /></button>
    </div>
  )
}

function Stats({ rows }: { rows: [string, string][] }) {
  return <div className="mt-3 grid grid-cols-2 gap-2">{rows.map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{k}</p><p className="font-bold">{v}</p></div>)}</div>
}

/** The cover above the tabs: the robot (or photo), the name, the title and the totals. */
export function JourneyCover({ name, photo, campus, journey }: { name: string; photo: string | null; campus: string; journey: Journey }) {
  return (
    <div className="keep-light flex flex-wrap items-center gap-4 rounded-3xl bg-[#102E52] p-4 text-white">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#FFC83D]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <Robot size={46} />}
      </div>
      <div className="min-w-0 flex-1">
        <p dir="auto" className="break-words text-2xl font-extrabold leading-tight">{name}</p>
        <p className="text-sm font-bold text-[#FFD45C]">{L(journey.title.en, journey.title.ar)}{campus && <span className="font-normal text-[#C9D8EC]"> · {campus}</span>}</p>
      </div>
      <div className="flex gap-2">
        <div className="rounded-2xl bg-[#0C2340] px-3 py-1.5 text-center"><p className="text-xl font-extrabold text-[#FFD45C]">{journey.stars}</p><p className="text-xs text-[#C9D8EC]">{L('stars', 'نجوم')}</p></div>
        <div className="rounded-2xl bg-[#0C2340] px-3 py-1.5 text-center"><p className="text-xl font-extrabold text-[#FFD45C]">{journey.levelsDone}</p><p className="text-xs text-[#C9D8EC]">{L('levels', 'مستويات')}</p></div>
      </div>
    </div>
  )
}

/** The journey in dates, newest at the bottom. */
export function JourneyTimeline({ events, ar }: { events: Journey['timeline']; ar: boolean }) {
  if (!events.length) return null
  return (
    <ol className="relative space-y-3 border-s-2 border-dashed border-indigo-200 ps-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className={`absolute -start-[29px] top-1 h-4 w-4 rounded-full border-2 border-white ${e.kind === 'LEVEL_DONE' || e.kind === 'CERTIFICATE' ? 'bg-amber-400' : e.kind === 'STAMP' ? 'bg-emerald-500' : 'bg-indigo-500'}`} aria-hidden="true" />
          <p className="text-xs text-slate-500">{day(e.at, ar)}</p>
          <p className="text-sm font-medium text-slate-800">{ar ? e.ar : e.en}</p>
        </li>
      ))}
    </ol>
  )
}

/** The parent's summary above the map (owner 2026-11-10): where the child is, attendance, what is left, the last report, the next step. */
export function ParentSummary({ journey, studentId, next, canBook, onBook, booking }: { journey: Journey; studentId: string; next: { levelId: string; label: string } | null; canBook: boolean; onBook: (levelId: string) => void; booking: boolean }) {
  const ar = useI18n().locale === 'ar'
  const now = journey.levels.filter((l) => l.state === 'CURRENT')
  const Item = ({ k, v, warn }: { k: string; v: string; warn?: boolean }) => (
    <div className="rounded-xl bg-white px-3 py-2"><p className="text-xs text-slate-500">{k}</p><p className={`font-bold ${warn ? 'text-rose-600' : 'text-slate-900'}`}>{v}</p></div>
  )
  return (
    <section aria-label={L('Summary for the parent', 'ملخص لولي الأمر')} className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
      <h2 className="mb-3 text-base font-bold text-slate-900">{L('At a glance', 'الملخص في ثانية')}</h2>
      {now.length === 0 && <p className="mb-3 text-sm text-slate-600">{L('Not in a level right now.', 'مش في مستوى دلوقتي.')}</p>}
      {now.map((l) => (
        <div key={l.levelId} className="mb-3">
          <p className="mb-2 text-sm font-semibold text-indigo-800">{L('Now', 'دلوقتي')}: {l.course} · {l.name}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Item k={L('Attendance', 'الحضور')} v={l.attendancePct != null ? `${l.attendancePct}%` : '—'} warn={l.attendancePct != null && l.attendancePct < 75} />
            <Item k={L('Homework not handed in', 'واجبات ما اتسلمتش')} v={String(l.left?.homework ?? 0)} warn={(l.left?.homework ?? 0) > 0} />
            <Item k={L('Sessions left', 'حصص فاضلة')} v={String(l.left?.sessions ?? 0)} />
            <Item k={L('Quizzes', 'الكويزات')} v={l.quizPct != null ? `${l.quizPct}%` : '—'} />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {journey.lastReport
          ? <a href={`/reports/session/${journey.lastReport.id}?student=${studentId}`} className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 font-medium text-indigo-700 underline-offset-2 hover:underline">{L('Last session report', 'آخر تقرير حصة')}: {day(journey.lastReport.date, ar)}</a>
          : <span className="text-slate-500">{L('No session report yet.', 'لسه مفيش تقرير حصة.')}</span>}
        {next && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-slate-700">{L('Next step', 'الخطوة الجاية')}: <b>{next.label}</b></span>
            {canBook && <Button size="sm" disabled={booking} onClick={() => onBook(next.levelId)}>{L('I want to book', 'عايز أحجز')}</Button>}
          </span>
        )}
      </div>
    </section>
  )
}
