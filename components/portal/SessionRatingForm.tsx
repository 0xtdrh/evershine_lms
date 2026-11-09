'use client'

/** One session's questions. Stars for a student, faces for a parent answering about a young child. */

import { useState } from 'react'
import { Star } from 'lucide-react'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'

export interface AskedQuestion { id: string; en: string; ar: string }
const FACE_VALUES = [{ v: 1, f: '🙁' }, { v: 2, f: '😐' }, { v: 4, f: '🙂' }, { v: 5, f: '😀' }]

export function SessionRatingForm({ questions, mode, busy, onSend }: { questions: AskedQuestion[]; mode: 'STARS' | 'FACES'; busy: boolean; onSend: (answers: Record<string, number>, comment: string | null) => void }) {
  const [a, setA] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const set = (id: string, v: number) => setA((x) => ({ ...x, [id]: v }))
  return (
    <div className="w-full space-y-2">
      {questions.map((q) => (
        <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{L(q.en, q.ar)}</span>
          {mode === 'STARS' ? (
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} / 5`} onClick={() => set(q.id, n)}><Star className={`h-6 w-6 ${n <= (a[q.id] ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>
              ))}
            </div>
          ) : (
            <div className="flex gap-1">
              {FACE_VALUES.map((x) => (
                <button key={x.v} type="button" className={`rounded-lg px-1.5 text-2xl ${a[q.id] === x.v ? 'bg-amber-100' : 'hover:bg-slate-100'}`} onClick={() => set(q.id, x.v)}>{x.f}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      <input className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={L('Anything to add? (optional)', 'عايز تقول حاجة؟ (اختياري)')} />
      <div className="flex justify-end"><Button size="sm" disabled={busy || questions.some((q) => !a[q.id])} onClick={() => onSend(a, comment.trim() || null)}>{L('Send', 'ابعت')}</Button></div>
    </div>
  )
}
