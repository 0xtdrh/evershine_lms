'use client'

/** LMS L4: one quiz for a student (or a parent: ?s=<childId>, results only). */

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useI18n } from '@/lib/i18n/client'
import { QuizPlayer } from '@/components/quizzes/QuizPlayer'
import { ArrowLeft } from 'lucide-react'

export default function MyQuizPage() {
  const { blockId } = useParams<{ blockId: string }>()
  const q = useSearchParams()
  const { t, dir } = useI18n()
  return (
    <div className="space-y-4 print:hidden" dir={dir}>
      <Link href="/dashboard/my-quizzes" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {t('qz.myQuizzes')}</Link>
      <QuizPlayer groupId={q.get('g') ?? ''} blockId={blockId} studentId={q.get('s')} />
    </div>
  )
}
