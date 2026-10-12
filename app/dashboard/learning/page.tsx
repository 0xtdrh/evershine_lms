'use client'

/**
 * "My learning" — the student's / parent's one place for the LMS: a short summary on top and tabs for lessons,
 * homework, quizzes and the projects gallery (the same pages as before, inside tabs). Bilingual.
 */

import { JoinOnlineCard } from '@/components/online/JoinOnlineCard'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import MyLessonsPage from '../my-lessons/page'
import MyAssignmentsPage from '../my-assignments/page'
import MyQuizzesPage from '../my-quizzes/page'
import GalleryPage from '../gallery/page'
import { BookOpen, ClipboardList, Images, ListChecks } from 'lucide-react'

const TABS = [
  { key: 'lessons', en: 'Lessons', ar: 'دروسي', icon: BookOpen },
  { key: 'homework', en: 'Homework', ar: 'واجباتي', icon: ClipboardList },
  { key: 'quizzes', en: 'Quizzes', ar: 'كويزاتي', icon: ListChecks },
  { key: 'gallery', en: 'Gallery', ar: 'المعرض', icon: Images },
] as const
type Tab = (typeof TABS)[number]['key']

interface Hw { groups: { items: { status: string; score: number | null; maxScore: number }[] }[] }
interface Qz { groups: { items: { used: number; allowed: number; inProgress: boolean; result: { score: number; max: number } | null }[] }[] }

export default function LearningPage() {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const router = useRouter()
  const params = useSearchParams()
  const { data: session } = useSession()
  const isParent = session?.user?.role === 'PARENT' || session?.user?.role === 'GUARDIAN'
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'lessons')
  useEffect(() => { const t = params.get('tab') as Tab | null; if (t && t !== tab) setTab(t) }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  // the summary is for the student (parents choose a child inside each tab)
  const { data: hw } = useQuery({ queryKey: ['my-assignments', null], queryFn: () => fetchApi<Hw>('/api/assignments/my'), enabled: !!session && !isParent, retry: false })
  const { data: qz } = useQuery({ queryKey: ['my-quizzes', null], queryFn: () => fetchApi<Qz>('/api/quizzes/my'), enabled: !!session && !isParent, retry: false })
  const items = hw?.groups.flatMap((g) => g.items) ?? []
  const todo = items.filter((i) => i.status === 'TODO' || i.status === 'DRAFT' || i.status === 'RETURNED').length
  const quizzes = qz?.groups.flatMap((g) => g.items) ?? []
  const quizOpen = quizzes.filter((q) => q.inProgress || (!q.result && q.used < q.allowed)).length
  const last = items.filter((i) => i.status === 'GRADED' && i.score !== null).slice(-1)[0]
  const go = (t: Tab) => { setTab(t); router.replace(`/dashboard/learning?tab=${t}`, { scroll: false }) }

  return (
    <div className="space-y-5" dir={dir}>
      {!isParent && <JoinOnlineCard />}
      {!isParent && (hw || qz) && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => go('homework')} className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-start">
            <p className="text-2xl font-bold text-violet-700">{todo}</p><p className="text-xs text-slate-600">{ar ? 'واجبات مطلوبة' : 'homework to do'}</p>
          </button>
          <button type="button" onClick={() => go('quizzes')} className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 text-start">
            <p className="text-2xl font-bold text-sky-700">{quizOpen}</p><p className="text-xs text-slate-600">{ar ? 'كويزات مستنياك' : 'quizzes waiting for you'}</p>
          </button>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
            <p className="text-2xl font-bold text-emerald-700">{last ? `${last.score}/${last.maxScore}` : '—'}</p><p className="text-xs text-slate-600">{ar ? 'آخر درجة واجب' : 'latest homework grade'}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => go(t.key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <t.icon className="h-4 w-4" /> {ar ? t.ar : t.en}
          </button>
        ))}
      </div>
      {tab === 'lessons' && <MyLessonsPage />}
      {tab === 'homework' && <MyAssignmentsPage />}
      {tab === 'quizzes' && <MyQuizzesPage />}
      {tab === 'gallery' && <GalleryPage />}
    </div>
  )
}
