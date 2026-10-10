'use client'

/** LMS L3: "My homework" — student (hand in) or parent (choose a child: status, grades, feedback). Bilingual. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ClipboardList, Loader2 } from 'lucide-react'

interface Item { blockId: string; sessionNumber: number; titleEn: string | null; titleAr: string | null; sessionTitleEn: string; sessionTitleAr: string; finalProject: boolean; dueAt: string | null; maxScore: number; status: string; score: number | null; late: boolean; feedback: string | null; resultsAt?: string | null }
interface Data { asParent: boolean; studentId: string; groups: { group: { id: string; label: string; courseName: string; levelName: string }; items: Item[] }[] }
interface Child { id: string; firstName: string }

const STYLE: Record<string, string> = {
  TODO: 'border-slate-200 bg-slate-50 text-slate-600', DRAFT: 'border-sky-200 bg-sky-50 text-sky-700', SUBMITTED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  RETURNED: 'border-amber-200 bg-amber-50 text-amber-800', GRADED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export default function MyAssignmentsPage() {
  const { data: session } = useSession()
  const { t, pick, dir, locale } = useI18n()
  const role = session?.user?.role ?? ''
  const isParent = role === 'PARENT' || role === 'GUARDIAN'
  const { data: children } = useQuery({ queryKey: ['guardian-children'], queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'), enabled: isParent })
  const [child, setChild] = useState<string | null>(null)
  useEffect(() => { if (isParent && !child && children?.length) setChild(children[0].id) }, [isParent, child, children])
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-assignments', child],
    queryFn: () => fetchApi<Data>(`/api/assignments/my${child ? `?s=${child}` : ''}`),
    enabled: !!role && (!isParent || !!child),
  })
  return (
    <div className="space-y-5" dir={dir}>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList className="h-7 w-7 text-violet-600" /> {t('hw.myHomework')}</h1>
      {isParent && (children?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2">
          {children!.map((c) => <button key={c.id} type="button" onClick={() => setChild(c.id)} className={`rounded-full border px-3 py-1 text-sm ${child === c.id ? 'border-violet-400 bg-violet-50 font-semibold text-violet-700' : 'border-slate-200 text-slate-600'}`}>{c.firstName}</button>)}
        </div>
      )}
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        : error ? <p className="text-sm text-slate-500">{(error as Error).message.includes('switched on') ? t('les.off') : (error as Error).message}</p>
        : !data?.groups.length ? <p className="text-sm text-slate-500">{t('hw.none')}</p>
        : data.groups.map((g) => (
          <Card key={g.group.id}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{g.group.courseName} — {g.group.levelName}</CardTitle><p className="text-xs text-slate-500">{g.group.label}</p></CardHeader>
            <CardContent className="space-y-2">
              {g.items.map((i) => (
                <Link key={i.blockId} href={`/dashboard/my-assignments/${i.blockId}?g=${g.group.id}${data.asParent ? `&s=${data.studentId}` : ''}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">{pick(i.titleEn, i.titleAr) || t('hw.homework')}{i.finalProject ? ` · ${t('hw.finalProject')}` : ''}</span>
                    <span className="block text-xs text-slate-500">{t('cur.session', { n: i.sessionNumber })} · {pick(i.sessionTitleEn, i.sessionTitleAr)}{i.dueAt ? ` · ${t('hw.due', { date: new Date(i.dueAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') })}` : ''}</span>
                    {i.feedback && <span className="mt-1 block text-xs text-slate-600">💬 {i.feedback}</span>}
                  </span>
                  <span className="flex items-center gap-1 text-xs">
                    {i.late && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">{t('hw.late')}</span>}
                    <span className={`rounded-full border px-2 py-0.5 ${STYLE[i.status]}`}>{t(`hw.status.${i.status}` as 'hw.status.TODO')}</span>
                    {i.status === 'GRADED' && i.score !== null && <span className="font-bold text-emerald-700">{i.score} / {i.maxScore}</span>}
                    {i.status === 'GRADED' && i.score === null && <span className="text-slate-500">{i.resultsAt ? t('hw.resultsOn', { date: new Date(i.resultsAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB') }) : t('hw.resultsLater')}</span>}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
