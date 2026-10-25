'use client'

/** LMS L3: "My homework" — student (hand in) or parent (choose a child: status, grades, feedback). Bilingual. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { useI18n } from '@/lib/i18n/client'
import { ClipboardList } from 'lucide-react'
import { HomeworkList } from '@/components/assignments/HomeworkList'

interface Child { id: string; firstName: string }

export default function MyAssignmentsPage() {
  const { data: session } = useSession()
  const { t, dir } = useI18n()
  const role = session?.user?.role ?? ''
  const isParent = role === 'PARENT' || role === 'GUARDIAN'
  const { data: children } = useQuery({ queryKey: ['guardian-children'], queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'), enabled: isParent })
  const [child, setChild] = useState<string | null>(null)
  useEffect(() => { if (isParent && !child && children?.length) setChild(children[0].id) }, [isParent, child, children])
  return (
    <div className="space-y-5" dir={dir}>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList className="h-7 w-7 text-violet-600" /> {t('hw.myHomework')}</h1>
      {isParent && (children?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2">
          {children!.map((c) => <button key={c.id} type="button" onClick={() => setChild(c.id)} className={`rounded-full border px-3 py-1 text-sm ${child === c.id ? 'border-violet-400 bg-violet-50 font-semibold text-violet-700' : 'border-slate-200 text-slate-600'}`}>{c.firstName}</button>)}
        </div>
      )}
      <HomeworkList studentId={child} enabled={!!role && (!isParent || !!child)} />
    </div>
  )
}
