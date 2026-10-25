'use client'

/** R1: printable session report of one student (outside the dashboard so it prints clean). ?student=<id> */

import { use } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Printer } from 'lucide-react'

interface Report {
  id: string; status: string; sentAt: string | null; date: string; sessionNumber: number | null; perCycle: number | null
  student: { id: string; name: string; reg: string }
  group: { id: string; label: string; course: string; level: string; campus: string }
  teacher: string
  lesson: { id: string; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null } | null
  attendance: string
  missedLessonLink: string | null
  previousHomework: { title: string; state: 'DONE' | 'LATE' | 'MISSING' | 'NOT_DUE'; grade: 'SHOWN' | 'GRADING' | 'LATER' | 'RETURNED' | 'NONE'; score: number | null; maxScore: number | null; gradesAt: string | null }[]
  quizzes: { title: string; state: 'DONE' | 'GRADING' | 'NOT_TAKEN'; percent: number | null; passed: boolean | null }[]
  activities?: { title: string; percent: number | null; completed: boolean }[]
  nextHomework: { title: string; dueAt: string | null }[]
  star: boolean
  phrases: { en: string; ar: string }[]
  comment: string | null
  groupNote: string | null
}

const fmtDay = (d: string, ar: boolean) => new Date(`${d}T00:00:00Z`).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtTime = (d: string, ar: boolean) => new Date(d).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="border-b border-gray-400 pb-0.5 font-bold">{title}</h3>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  )
}

function ReportBody({ id }: { id: string }) {
  const studentId = useSearchParams().get('student') ?? ''
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const { data: r, error, isLoading } = useQuery({ queryKey: ['session-report-view', id, studentId], queryFn: () => fetchApi<Report>(`/api/session-reports/${id}?student=${studentId}`), retry: false, enabled: !!studentId })
  if (error) return <div className="p-6 text-sm"><p className="mb-2 text-red-600">{(error as Error).message}</p><Link href="/login" className="text-blue-600 underline">{L('Sign in', 'تسجيل الدخول')}</Link></div>

  const att: Record<string, string> = { PRESENT: L('Present ✅', 'حاضر ✅'), LATE: L('Arrived late ⏰', 'وصل متأخر ⏰'), ABSENT: L('Absent', 'غايب'), EXCUSED: L('Absent (excused)', 'غياب بعذر') }
  const hwState: Record<string, string> = { DONE: L('Handed in on time ✅', 'اتسلّم في معاده ✅'), LATE: L('Handed in late', 'اتسلّم متأخر'), MISSING: L('Not handed in ❌', 'ماتسلّمش ❌'), NOT_DUE: L('Not due yet', 'لسه معادهوش جه') }
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={dir}>
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}><ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" /> {L('Back', 'رجوع')}</Button>
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" /> {L('Print / save as PDF', 'طباعة / حفظ PDF')}</Button>
        <LanguageSwitch />
      </div>
      {isLoading || !r ? <p className="text-center text-sm text-gray-500">{L('Loading…', 'جاري التحميل…')}</p> : (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none">
          <div className="mb-3 flex items-start justify-between border-b-2 border-black pb-2">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
              <div><div className="text-lg font-bold">TechNova</div><div className="text-xs">STEM · Robotics · Programming</div></div>
            </div>
            <div className="text-end">
              <div className="font-bold">{L('SESSION REPORT', 'تقرير الحصة')}</div>
              <div className="text-xs">{fmtDay(r.date, ar)}</div>
              {r.status !== 'SENT' && <div className="mt-1 rounded border border-amber-500 px-1 text-xs font-bold text-amber-700">{L('DRAFT — not sent yet', 'مسودة — لسه ماتبعتش')}</div>}
            </div>
          </div>

          <p className="text-base"><strong>{r.student.name}</strong> · {r.student.reg}{r.star && <span className="ms-2 rounded-full border border-amber-500 px-2 py-0.5 text-xs font-bold text-amber-700">⭐ {L('Star of the session', 'نجم الحصة')}</span>}</p>
          <p className="text-gray-700">
            {r.group.course}{r.group.level ? ` · ${r.group.level}` : ''} · {r.group.label}
            {r.sessionNumber ? ` · ${L('session', 'الحصة')} ${r.sessionNumber}${r.perCycle ? ` ${L('of', 'من')} ${r.perCycle}` : ''}` : ''}
            {r.teacher ? ` · ${L('Instructor', 'المدرب')}: ${r.teacher}` : ''}
          </p>

          <Section title={L('What we did today', 'عملنا إيه النهارده')}>
            {r.lesson ? (
              <>
                <p className="font-semibold">{(ar && r.lesson.titleAr) || r.lesson.titleEn}</p>
                {((ar && r.lesson.objectivesAr) || r.lesson.objectivesEn) && <p className="whitespace-pre-line text-gray-700">{(ar && r.lesson.objectivesAr) || r.lesson.objectivesEn}</p>}
              </>
            ) : <p className="text-gray-500">{L('—', '—')}</p>}
            {r.groupNote && <p className="rounded bg-gray-50 p-2">{r.groupNote}</p>}
          </Section>

          <Section title={L('Attendance', 'الحضور')}>
            <p>{att[r.attendance] ?? r.attendance}</p>
            {r.missedLessonLink && (
              <p className="text-gray-700">{L('You missed this session — the lesson is on the platform to review at home.', 'فاتتك الحصة دي — الدرس موجود على المنصة تراجعه في البيت.')} <a href={r.missedLessonLink} className="text-blue-700 underline print:hidden">{L('Open the lesson', 'افتح الدرس')}</a></p>
            )}
          </Section>

          {r.previousHomework.length > 0 && (
            <Section title={L('Homework of the last session', 'واجب الحصة اللي فاتت')}>
              {r.previousHomework.map((h, i) => (
                <p key={i}>
                  <span className="font-medium">{h.title}</span> — {hwState[h.state]}
                  {h.grade === 'SHOWN' && h.score != null && <strong> · {L('Grade', 'الدرجة')} {h.score} / {h.maxScore}</strong>}
                  {h.grade === 'GRADING' && <span className="text-gray-600"> · {L('grading in progress', 'جاري التصحيح')}</span>}
                  {h.grade === 'RETURNED' && <span className="text-gray-600"> · {L('the instructor asked for changes', 'المدرب طلب تعديلات')}</span>}
                  {h.grade === 'LATER' && <span className="text-gray-600"> · {L('the grade is shown', 'الدرجة هتظهر')} {h.gradesAt ? fmtTime(h.gradesAt, ar) : L('later', 'بعدين')}</span>}
                </p>
              ))}
            </Section>
          )}

          {r.quizzes.length > 0 && (
            <Section title={L('Quiz', 'الكويز')}>
              {r.quizzes.map((q, i) => (
                <p key={i}>
                  <span className="font-medium">{q.title}</span> — {q.state === 'DONE' ? <strong>{q.percent}% {q.passed ? '✅' : ''}</strong> : q.state === 'GRADING' ? L('grading in progress', 'جاري التصحيح') : L('not taken', 'ماتحلّش')}
                </p>
              ))}
            </Section>
          )}

          {!!r.activities?.length && (
            <Section title={L('Interactive activities', 'الأنشطة التفاعلية')}>
              {r.activities.map((a, i) => (
                <p key={i}><span className="font-medium">{a.title}</span> — {a.percent != null ? <strong>{a.percent}%</strong> : a.completed ? L('done ✅', 'خلّصه ✅') : L('not done yet', 'لسه ماخلّصهوش')}</p>
              ))}
            </Section>
          )}

          {(r.phrases.length > 0 || r.comment) && (
            <Section title={L("Instructor's note", 'كلمة المدرب')}>
              {r.phrases.length > 0 && <p className="flex flex-wrap gap-1">{r.phrases.map((p, i) => <span key={i} className="rounded-full border border-indigo-300 px-2 py-0.5 text-xs">{ar ? p.ar : p.en}</span>)}</p>}
              {r.comment && <p>{r.comment}</p>}
            </Section>
          )}

          {r.nextHomework.length > 0 && (
            <Section title={L('Next homework', 'الواجب الجاي')}>
              {r.nextHomework.map((h, i) => <p key={i}><span className="font-medium">{h.title}</span>{h.dueAt ? ` — ${L('due', 'آخر معاد')} ${fmtTime(h.dueAt, ar)}` : ''}</p>)}
            </Section>
          )}

          <p className="mt-5 text-[11px] text-gray-500">{L('Prepared automatically from attendance, homework and quizzes. Grades given later appear here by themselves. You can rate the session from the portal.', 'التقرير ده بيتعمل أوتوماتيك من الحضور والواجبات والكويزات. الدرجات اللي بتتحط بعدين بتظهر هنا لوحدها. تقدر تقيّم الحصة من البورتال.')}</p>
        </div>
      )}
    </div>
  )
}

export default function SessionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <I18nProvider><ReportBody id={id} /></I18nProvider>
}
