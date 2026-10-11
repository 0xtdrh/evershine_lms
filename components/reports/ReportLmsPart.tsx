'use client'

/**
 * R2: the LMS part of the printable monthly / level report — homework, quizzes, stars, projects, the instructor's words,
 * the skills chart (radar when 3+ skills are measured, bars always) and, for the parent, "book the next level".
 */

import { useState } from 'react'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'

export interface SkillScore { id: string; nameEn: string; nameAr: string; percent: number | null; items: number }
export interface LmsPart {
  homework?: { due: number; handedInPct: number | null; onTimePct: number | null; average: number | null }
  quizAverage?: number | null
  stars: number
  projects: { titleEn: string; titleAr: string }[]
  quote: { text: string; date: string } | null
  topPhrase: { en: string; ar: string } | null
  skills: { scores: SkillScore[]; strong: SkillScore[]; weak: SkillScore[] } | null
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)

function Radar({ scores, ar }: { scores: SkillScore[]; ar: boolean }) {
  const s = scores.filter((x) => x.percent != null)
  const n = s.length, R = 90, cx = 150, cy = 120
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]
  }
  const ring = (v: number) => s.map((_, i) => pt(i, v).join(',')).join(' ')
  return (
    <svg viewBox="0 0 300 240" className="mx-auto h-56 w-full max-w-sm" role="img" aria-label={L('Skills chart', 'رسم المهارات')}>
      {[0.25, 0.5, 0.75, 1].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke="#d1d5db" strokeWidth="1" />)}
      {s.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" /> })}
      <polygon points={s.map((k, i) => pt(i, (k.percent ?? 0) / 100).join(',')).join(' ')} fill="rgba(79,70,229,0.25)" stroke="#4f46e5" strokeWidth="2" />
      {s.map((k, i) => {
        const [x, y] = pt(i, 1.18)
        return <text key={k.id} x={x} y={y} fontSize="10" textAnchor={Math.abs(x - cx) < 10 ? 'middle' : x > cx ? 'start' : 'end'} dominantBaseline="middle" fill="#111827">{(ar && k.nameAr) || k.nameEn} {k.percent}%</text>
      })}
    </svg>
  )
}

export function ReportLmsPart({ lms, kind, nextLevel, studentId, groupId, isParent }: {
  lms: LmsPart | null | undefined; kind: 'MONTHLY' | 'LEVEL'
  nextLevel?: { nextLevel: string | null; asked: boolean } | null; studentId: string; groupId: string; isParent: boolean
}) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!lms) return null
  const name = (k: { nameEn: string; nameAr: string }) => (ar && k.nameAr) || k.nameEn
  const measured = lms.skills?.scores.filter((s) => s.percent != null) ?? []
  const ask = async () => {
    setBusy(true); setErr(null)
    try { await fetchApi(`/api/students/${studentId}/next-level`, { method: 'POST', body: JSON.stringify({ group: groupId }) }); setAsked(true) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const hasLearning = (lms.homework && lms.homework.due > 0) || lms.quizAverage != null || lms.stars > 0 || lms.projects.length > 0 || lms.quote || lms.topPhrase

  return (
    <>
      {hasLearning && (
        <>
          <h3 className="mt-4 border-b border-gray-400 font-bold">{L('Learning on the platform', 'التعلّم على المنصة')}</h3>
          <div className="my-1 space-y-1">
            {lms.homework && lms.homework.due > 0 && <p>{L('Homework handed in', 'الواجبات اللي اتسلّمت')}: <strong>{pct(lms.homework.handedInPct)}</strong> {L('of', 'من')} {lms.homework.due} · {L('on time', 'في معادها')} {pct(lms.homework.onTimePct)} · {L('average grade', 'متوسط الدرجة')} <strong>{pct(lms.homework.average)}</strong></p>}
            {lms.quizAverage != null && <p>{L('Quiz average', 'متوسط الكويزات')}: <strong>{pct(lms.quizAverage)}</strong></p>}
            {lms.stars > 0 && <p>⭐ {L(`Star of the session ${lms.stars} time(s)`, `نجم الحصة ${lms.stars} مرة`)}</p>}
            {lms.projects.length > 0 && <p>{L('Projects in the gallery', 'مشاريع في المعرض')}: {lms.projects.map((p) => (ar ? p.titleAr : p.titleEn)).join(' · ')}</p>}
            {lms.topPhrase && <p>{L('The instructor says most often', 'أكتر جملة قالها المدرب')}: <strong>“{ar ? lms.topPhrase.ar : lms.topPhrase.en}”</strong></p>}
            {lms.quote && <p>{L("Instructor's latest comment", 'آخر تعليق من المدرب')}: “{lms.quote.text}”</p>}
          </div>
        </>
      )}

      {measured.length > 0 && (
        <>
          <h3 className="mt-4 border-b border-gray-400 font-bold">{L('Skills', 'المهارات')}</h3>
          {measured.length >= 3 && <Radar scores={lms.skills!.scores} ar={ar} />}
          <table className="my-1 w-full text-xs">
            <tbody>
              {measured.map((k) => (
                <tr key={k.id}>
                  <td className="w-40 py-0.5">{name(k)}</td>
                  <td className="py-0.5"><div className="h-2 rounded bg-gray-200"><div className={`h-2 rounded ${k.percent! >= 75 ? 'bg-emerald-600' : k.percent! >= 50 ? 'bg-indigo-600' : 'bg-amber-500'}`} style={{ width: `${k.percent}%` }} /></div></td>
                  <td className="w-12 py-0.5 text-end">{k.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lms.skills!.strong.length > 0 && <p className="text-xs">{L('Strong in', 'قوي في')}: <strong>{lms.skills!.strong.map(name).join('، ')}</strong></p>}
          {lms.skills!.weak.length > 0 && <p className="text-xs">{L('Needs practice in', 'محتاج يتمرّن على')}: <strong>{lms.skills!.weak.map(name).join('، ')}</strong></p>}
        </>
      )}

      {kind === 'LEVEL' && nextLevel && isParent && (
        <div className="mt-4 rounded border border-emerald-600 p-3 print:hidden">
          {nextLevel.asked || asked
            ? <p className="font-semibold text-emerald-700">✅ {L('We got your request for the next level — the branch will contact you.', 'وصلنا طلبك للمستوى الجاي — الفرع هيكلمك.')}</p>
            : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{L('Continue to', 'كمّل في')} <strong>{nextLevel.nextLevel ?? L('the next level', 'المستوى الجاي')}</strong>?</span>
                <button type="button" disabled={busy} onClick={ask} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{L('Book the next level', 'احجز المستوى الجاي')}</button>
              </div>
            )}
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
        </div>
      )}
    </>
  )
}
