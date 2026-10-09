'use client'

/** LMS L1: curriculum library — Track > Course > Level, with the curriculum status of each level. */

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { checkPermission } from '@/lib/rbac'
import { useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react'

interface LevelNode { id: string; name: string; numberOfSessions: number; publishedNumber: number | null; draftCount: number; reviewCount: number }
interface Tree { tree: { id: string; name: string; courses: { id: string; name: string; levels: LevelNode[] }[] }[] }

export default function CurriculumPage() {
  const { data: session } = useSession()
  const { t } = useI18n()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'curriculum', 'read')
  const { data, isLoading } = useQuery({ queryKey: ['curriculum-tree'], queryFn: () => fetchApi<Tree>('/api/curriculum/tree'), enabled: allowed })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Curriculum" message="You don't have access to the curriculum." />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookOpen className="h-7 w-7 text-indigo-600" /> {t('cur.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('cur.subtitle')}</p>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : !data?.tree.length ? <p className="text-sm text-slate-500">{t('common.none')}</p> : (
        data.tree.map((track) => (
          <div key={track.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">{track.name}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {track.courses.map((c) => (
                <Card key={c.id}>
                  <CardHeader className="pb-2"><CardTitle className="text-base">{c.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {c.levels.map((l) => (
                      <Link key={l.id} href={`/dashboard/curriculum/level/${l.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
                        <span className="font-medium text-slate-800">{l.name} <span className="text-xs font-normal text-slate-400">· {l.numberOfSessions} sessions</span></span>
                        <span className="flex items-center gap-1">
                          {l.publishedNumber ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">v{l.publishedNumber}</span>
                            : <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">no curriculum</span>}
                          {l.reviewCount > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{t('cur.status.IN_REVIEW')}</span>}
                          {l.draftCount > 0 && <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{t('cur.status.DRAFT')}</span>}
                          <ChevronRight className="h-4 w-4 text-slate-400 rtl:rotate-180" />
                        </span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
