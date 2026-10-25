'use client'

/**
 * LMS homework of one student — status, grade, feedback (2026-10-25: shared by "My homework" and the parent's
 * Results tab, which showed the template's old task marks instead of the real LMS homework).
 * studentId = a child of the signed-in parent; omit it for the signed-in student.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

interface Item { blockId: string; sessionNumber: number; titleEn: string | null; titleAr: string | null; sessionTitleEn: string; sessionTitleAr: string; finalProject: boolean; dueAt: string | null; maxScore: number; status: string; score: number | null; late: boolean; feedback: string | null; resultsAt?: string | null }
interface Data { asParent: boolean; studentId: string; groups: { group: { id: string; label: string; courseName: string; levelName: string }; items: Item[] }[] }

const STYLE: Record<string, string> = {
  TODO: 'border-slate-200 bg-slate-50 text-slate-600', DRAFT: 'border-sky-200 bg-sky-50 text-sky-700', SUBMITTED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  RETURNED: 'border-amber-200 bg-amber-50 text-amber-800', GRADED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export function HomeworkList({ studentId, enabled = true }: { studentId?: string | null; enabled?: boolean }) {
  const { t, pick, locale } = useI18n()
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo' })
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-assignments', studentId ?? null],
    queryFn: () => fetchApi<Data>(`/api/assignments/my${studentId ? `?s=${studentId}` : ''}`),
    enabled,
  })
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error) return <p className="text-sm text-slate-500">{(error as Error).message.includes('switched on') ? t('les.off') : (error as Error).message}</p>
  if (!data?.groups.length) return <p className="text-sm text-slate-500">{t('hw.none')}</p>
  return (
    <>
      {data.groups.map((g) => (
        <Card key={g.group.id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{g.group.courseName} — {g.group.levelName}</CardTitle><p className="text-xs text-slate-500">{g.group.label}</p></CardHeader>
          <CardContent className="space-y-2">
            {g.items.map((i) => (
              <Link key={i.blockId} href={`/dashboard/my-assignments/${i.blockId}?g=${g.group.id}${data.asParent ? `&s=${data.studentId}` : ''}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 p-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">{pick(i.titleEn, i.titleAr) || t('hw.homework')}{i.finalProject ? ` · ${t('hw.finalProject')}` : ''}</span>
                  <span className="block text-xs text-slate-500">{t('cur.session', { n: i.sessionNumber })} · {pick(i.sessionTitleEn, i.sessionTitleAr)}{i.dueAt ? ` · ${t('hw.due', { date: fmt(i.dueAt) })}` : ''}</span>
                  {i.feedback && <span className="mt-1 block text-xs text-slate-600">💬 {i.feedback}</span>}
                </span>
                <span className="flex items-center gap-1 text-xs">
                  {i.late && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">{t('hw.late')}</span>}
                  <span className={`rounded-full border px-2 py-0.5 ${STYLE[i.status]}`}>{t(`hw.status.${i.status}` as 'hw.status.TODO')}</span>
                  {i.status === 'GRADED' && i.score !== null && <span className="font-bold text-emerald-700">{i.score} / {i.maxScore}</span>}
                  {i.status === 'GRADED' && i.score === null && <span className="text-slate-500">{i.resultsAt ? t('hw.resultsOn', { date: fmt(i.resultsAt) }) : t('hw.resultsLater')}</span>}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  )
}
