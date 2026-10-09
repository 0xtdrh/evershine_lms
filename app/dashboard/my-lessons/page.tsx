'use client'

/**
 * LMS L2: "My lessons". Student: their groups with every lesson (open ones can be opened, locked ones show a lock).
 * Parent: choose a child → what was learned so far (read-only). Bilingual (EN / عربي).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Markdown } from '@/components/curriculum/BlockView'
import { BookOpen, CheckCircle2, Loader2, Lock } from 'lucide-react'

interface StudentSession { id: string; number: number; titleEn: string; titleAr: string; open: boolean; current: boolean; inThisGroup: boolean; items: number; done: number }
interface StudentGroup { group: { id: string; label: string; courseName: string; levelName: string; status: string }; edition: { number: number } | null; sessions: StudentSession[] }
interface ParentGroup { group: { id: string; label: string; courseName: string; levelName: string }; total: number; sessions: { number: number; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null; items: number; done: number }[] }
interface MyData { mode: 'STUDENT' | 'PARENT'; kidMode?: boolean; groups: (StudentGroup | ParentGroup)[] }
interface Child { id: string; firstName: string; lastName: string }

function StudentView({ groups, kid }: { groups: StudentGroup[]; kid: boolean }) {
  const { t, pick } = useI18n()
  return (
    <>
      {groups.map((g) => {
        const open = g.sessions.filter((s) => s.open)
        return (
          <Card key={g.group.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{g.group.courseName} — {g.group.levelName}</CardTitle>
              <p className="text-xs text-slate-500">{g.group.label} · {t('les.progress', { done: open.filter((s) => s.items > 0 && s.done >= s.items).length, total: g.sessions.length })}</p>
            </CardHeader>
            <CardContent className={`grid gap-2 ${kid ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
              {g.sessions.map((s) => {
                const finished = s.items > 0 && s.done >= s.items
                const title = pick(s.titleEn, s.titleAr) || t('cur.session', { n: s.number })
                const inner = (
                  <div className={`flex h-full items-start gap-3 rounded-xl border p-3 ${s.open ? 'border-indigo-100 bg-white hover:shadow-md' : 'border-slate-100 bg-slate-50 opacity-70'} ${kid ? 'p-4' : ''}`}>
                    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${kid ? 'h-12 w-12 text-lg' : 'h-9 w-9 text-sm'} ${finished ? 'bg-emerald-100 text-emerald-700' : s.open ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                      {finished ? <CheckCircle2 className="h-5 w-5" /> : s.open ? s.number : <Lock className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className={`block font-semibold text-slate-800 ${kid ? 'text-lg' : 'text-sm'}`}>{title}</span>
                      <span className="block text-xs text-slate-500">
                        {!s.open ? t('les.locked') : s.items ? t('les.progress', { done: s.done, total: s.items }) : t('les.open')}
                        {s.current ? ` · ${t('les.current')}` : ''}
                      </span>
                    </span>
                  </div>
                )
                return s.open ? <Link key={s.id} href={`/dashboard/my-lessons/${s.id}?g=${g.group.id}`}>{inner}</Link> : <div key={s.id}>{inner}</div>
              })}
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}

function ParentView({ groups }: { groups: ParentGroup[] }) {
  const { t, pick } = useI18n()
  return (
    <>
      {groups.map((g) => (
        <Card key={g.group.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{g.group.courseName} — {g.group.levelName}</CardTitle>
            <p className="text-xs text-slate-500">{g.group.label} · {t('les.learned')}: {g.sessions.length} / {g.total}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {g.sessions.map((s) => (
              <div key={s.number} className="rounded-lg border border-slate-100 p-3">
                <p className="text-sm font-semibold text-slate-800">{s.number}. {pick(s.titleEn, s.titleAr)} {s.items > 0 && <span className="text-xs font-normal text-slate-500">· {t('les.progress', { done: s.done, total: s.items })}</span>}</p>
                {pick(s.objectivesEn, s.objectivesAr) && <Markdown text={pick(s.objectivesEn, s.objectivesAr)} />}
              </div>
            ))}
            {!g.sessions.length && <p className="text-sm text-slate-500">{t('les.none')}</p>}
          </CardContent>
        </Card>
      ))}
    </>
  )
}

export default function MyLessonsPage() {
  const { data: session } = useSession()
  const { t, dir } = useI18n()
  const role = session?.user?.role ?? ''
  const isParent = role === 'PARENT' || role === 'GUARDIAN'
  const { data: children } = useQuery({ queryKey: ['guardian-children'], queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'), enabled: isParent })
  const [child, setChild] = useState<string | null>(null)
  useEffect(() => { if (isParent && !child && children?.length) setChild(children[0].id) }, [isParent, child, children])
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-lessons', child],
    queryFn: () => fetchApi<MyData>(`/api/lessons/my${child ? `?s=${child}` : ''}`),
    enabled: !!role && (!isParent || !!child),
  })
  return (
    <div className="space-y-5" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookOpen className="h-7 w-7 text-indigo-600" /> {t('les.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('les.subtitle')}</p>
      </div>
      {isParent && (children?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2">
          {children!.map((c) => (
            <button key={c.id} type="button" onClick={() => setChild(c.id)} className={`rounded-full border px-3 py-1 text-sm ${child === c.id ? 'border-indigo-400 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 text-slate-600'}`}>{c.firstName}</button>
          ))}
        </div>
      )}
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        : error ? <p className="text-sm text-slate-500">{(error as Error).message.includes('switched on') ? t('les.off') : (error as Error).message}</p>
        : !data?.groups.length ? <p className="text-sm text-slate-500">{t('les.none')}</p>
        : data.mode === 'PARENT' ? <ParentView groups={data.groups as ParentGroup[]} />
        : <StudentView groups={data.groups as StudentGroup[]} kid={!!data.kidMode} />}
    </div>
  )
}
