'use client'

/** LMS L4: "My quizzes" — student (take them) or parent (choose a child: tries and scores). Bilingual. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ListChecks, Loader2 } from 'lucide-react'

interface Item { blockId: string; sessionNumber: number; titleEn: string | null; titleAr: string | null; kind: string; timeLimitMin: number; used: number; allowed: number; inProgress: boolean; waiting: boolean; result: { score: number; max: number; percent: number } | null; passMark: number }
interface Data { asParent: boolean; studentId: string; groups: { group: { id: string; label: string; courseName: string; levelName: string }; items: Item[] }[] }
interface Child { id: string; firstName: string }

export default function MyQuizzesPage() {
  const { data: session } = useSession()
  const { t, pick, dir } = useI18n()
  const role = session?.user?.role ?? ''
  const isParent = role === 'PARENT' || role === 'GUARDIAN'
  const { data: children } = useQuery({ queryKey: ['guardian-children'], queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'), enabled: isParent })
  const [child, setChild] = useState<string | null>(null)
  useEffect(() => { if (isParent && !child && children?.length) setChild(children[0].id) }, [isParent, child, children])
  const { data, isLoading, error } = useQuery({ queryKey: ['my-quizzes', child], queryFn: () => fetchApi<Data>(`/api/quizzes/my${child ? `?s=${child}` : ''}`), enabled: !!role && (!isParent || !!child) })
  return (
    <div className="space-y-5" dir={dir}>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ListChecks className="h-7 w-7 text-sky-600" /> {t('qz.myQuizzes')}</h1>
      {isParent && (children?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2">{children!.map((c) => <button key={c.id} type="button" onClick={() => setChild(c.id)} className={`rounded-full border px-3 py-1 text-sm ${child === c.id ? 'border-sky-400 bg-sky-50 font-semibold text-sky-700' : 'border-slate-200 text-slate-600'}`}>{c.firstName}</button>)}</div>
      )}
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        : error ? <p className="text-sm text-slate-500">{(error as Error).message.includes('switched on') ? t('les.off') : (error as Error).message}</p>
        : !data?.groups.length ? <p className="text-sm text-slate-500">{t('qz.none')}</p>
        : data.groups.map((g) => (
          <Card key={g.group.id}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{g.group.courseName} — {g.group.levelName}</CardTitle><p className="text-xs text-slate-500">{g.group.label}</p></CardHeader>
            <CardContent className="space-y-2">
              {g.items.map((i) => (
                <Link key={i.blockId} href={`/dashboard/my-quizzes/${i.blockId}?g=${g.group.id}${data.asParent ? `&s=${data.studentId}` : ''}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3 hover:bg-slate-50">
                  <span>
                    <span className="block font-semibold text-slate-800">{pick(i.titleEn, i.titleAr) || t(i.kind === 'FINAL' ? 'qz.final' : 'qz.quiz')}</span>
                    <span className="block text-xs text-slate-500">{t('cur.session', { n: i.sessionNumber })} · {i.timeLimitMin ? t('qz.minutes', { n: i.timeLimitMin }) : t('qz.noLimit')} · {t('qz.tries', { used: i.used, allowed: i.allowed })}</span>
                  </span>
                  <span className="text-sm">
                    {i.inProgress ? <span className="text-sky-700">{t('qz.resume')}</span>
                      : i.waiting ? <span className="text-slate-500">{t('qz.waiting')}</span>
                        : i.result ? <span className={`font-bold ${i.result.percent >= i.passMark ? 'text-emerald-700' : 'text-amber-700'}`}>{i.result.score} / {i.result.max}</span>
                          : <span className="text-slate-400">—</span>}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
