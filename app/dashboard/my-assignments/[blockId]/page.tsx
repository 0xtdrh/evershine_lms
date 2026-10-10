'use client'

/** LMS L3: one homework for a student (or a parent: ?s=<childId>). */

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useI18n } from '@/lib/i18n/client'
import { AssignmentWork } from '@/components/assignments/AssignmentWork'
import { ArrowLeft } from 'lucide-react'

export default function MyAssignmentPage() {
  const { blockId } = useParams<{ blockId: string }>()
  const q = useSearchParams()
  const { t, dir } = useI18n()
  return (
    <div className="space-y-4" dir={dir}>
      <Link href="/dashboard/my-assignments" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {t('hw.myHomework')}</Link>
      <AssignmentWork groupId={q.get('g') ?? ''} blockId={blockId} studentId={q.get('s')} />
    </div>
  )
}
