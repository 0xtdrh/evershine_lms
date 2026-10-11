'use client'

/** R2: tag a question / homework with the course skills it measures (feeds the skills chart in the level report). */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'

interface Skill { id: string; nameEn: string; nameAr: string }

export function SkillPicker({ subjectId, value, onChange }: { subjectId?: string | null; value: string[] | undefined; onChange: (ids: string[]) => void }) {
  const { locale } = useI18n()
  const { data } = useQuery({ queryKey: ['course-skills', subjectId], queryFn: () => fetchApi<Skill[]>(`/api/curriculum/skills?subjectId=${subjectId}`), enabled: !!subjectId, staleTime: 60_000 })
  if (!subjectId || !data) return null
  const ids = value ?? []
  if (!data.length) return <p className="text-[11px] text-slate-400">{L('Skills: add the course skills on the level page to tag this.', 'المهارات: ضيف مهارات الكورس من صفحة المستوى علشان تعلّم ده.')}</p>
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-slate-500">{L('Skills it measures', 'المهارات اللي بيقيسها')}:</span>
      {data.map((k) => {
        const on = ids.includes(k.id)
        return (
          <button key={k.id} type="button" onClick={() => onChange(on ? ids.filter((x) => x !== k.id) : [...ids, k.id].slice(0, 10))}
            className={`rounded-full border px-2 py-0.5 ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            {(locale === 'ar' && k.nameAr) || k.nameEn}
          </button>
        )
      })}
      {!ids.length && <span className="text-[11px] text-slate-400">{L('(none = the skills of the lesson)', '(لو مفيش = مهارات الحصة)')}</span>}
    </div>
  )
}
