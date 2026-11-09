'use client'

/** Ratings page: the average of each question, and (Super Admin / Admin) the questions themselves. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus } from 'lucide-react'

interface Q { id: string; en: string; ar: string; about: 'SESSION' | 'INSTRUCTOR'; active: boolean }
interface Settings { perSession: number; questions: Q[] }
interface Avg { id: string; en: string; ar: string; count: number; average: number | null }

export function RatingQuestionsCard({ averages }: { averages: Avg[] }) {
  useI18n()
  const qc = useQueryClient()
  const role = useSession().data?.user?.role
  const canEdit = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const { data } = useQuery({ queryKey: ['rating-settings'], queryFn: () => fetchApi<Settings>('/api/ratings/settings') })
  const [f, setF] = useState<Settings | null>(null)
  useEffect(() => { if (data) setF({ perSession: data.perSession, questions: data.questions }) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/ratings/settings', { method: 'PUT', body: JSON.stringify(f) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['rating-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const setQ = (i: number, p: Partial<Q>) => f && setF({ ...f, questions: f.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) })
  return (
    <Card id="questions">
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Session questions', 'أسئلة تقييم الحصة')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          {averages.map((a) => <p key={a.id} className="flex justify-between gap-2"><span>{L(a.en, a.ar)}</span><span className="text-slate-500">{a.average == null ? '-' : `${a.average} / 5`} ({a.count})</span></p>)}
        </div>
        {canEdit && f && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-xs text-slate-600">{L('Questions per session (they rotate)', 'عدد الأسئلة في الحصة (بتتبدّل)')}
              <Input type="number" min={1} max={10} className="h-8 w-20" value={f.perSession} onChange={(e) => setF({ ...f, perSession: Number(e.target.value) })} /></label>
            {f.questions.map((q, i) => (
              <div key={q.id} className="flex flex-wrap items-center gap-2">
                <input type="checkbox" aria-label={q.en} checked={q.active} onChange={(e) => setQ(i, { active: e.target.checked })} />
                <Input className="h-8 min-w-40 flex-1 text-xs" dir="rtl" placeholder="عربي" value={q.ar} onChange={(e) => setQ(i, { ar: e.target.value })} />
                <Input className="h-8 min-w-40 flex-1 text-xs" dir="ltr" placeholder="English" value={q.en} onChange={(e) => setQ(i, { en: e.target.value })} />
                <select className="h-8 rounded-md border border-slate-200 bg-white text-xs" value={q.about} onChange={(e) => setQ(i, { about: e.target.value as Q['about'] })}>
                  <option value="SESSION">{L('About the session', 'عن الحصة')}</option>
                  <option value="INSTRUCTOR">{L('About the instructor', 'عن المدرب')}</option>
                </select>
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setF({ ...f, questions: [...f.questions, { id: `q${Date.now().toString(36)}`, en: '', ar: '', about: 'SESSION', active: true }] })}><Plus className="h-4 w-4" /> {L('Add a question', 'ضيف سؤال')}</Button>
              <Button type="button" size="sm" disabled={save.isPending || f.questions.some((q) => !q.en.trim() && !q.ar.trim())} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
