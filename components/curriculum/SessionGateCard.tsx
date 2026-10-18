'use client'

/**
 * 2026-10-18: per session — what a student must finish here before the next session opens (owner: a setting per
 * session). A setting, so it can be changed on a published version too. Saved through /api/curriculum/sessions/[id]/gate.
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SessionGate } from '@/lib/lms/gate'
import { Loader2, LockKeyhole } from 'lucide-react'

export function SessionGateCard({ sessionId, sessionNumber, gate, canEdit, hasHomework, hasQuiz, onSaved }: {
  sessionId: string; sessionNumber: number; gate: SessionGate | null; canEdit: boolean; hasHomework: boolean; hasQuiz: boolean; onSaved: () => void
}) {
  const [f, setF] = useState<SessionGate>({ content: !!gate?.content, homework: gate?.homework ?? null, minHomeworkPct: gate?.minHomeworkPct ?? null, quiz: !!gate?.quiz, minQuizPct: gate?.minQuizPct ?? null })
  const save = useMutation({
    mutationFn: (g: SessionGate | null) => fetchApi(`/api/curriculum/sessions/${sessionId}/gate`, { method: 'PUT', body: JSON.stringify({ gate: g }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); onSaved() },
    onError: (e: Error) => notify.error(e.message),
  })
  const any = f.content || !!f.homework || f.quiz
  const num = (v: string) => (v === '' ? null : Math.min(100, Math.max(0, Number(v) || 0)))
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4 text-indigo-600" /> {L(`Before session ${sessionNumber + 1} opens`, `قبل ما الحصة ${sessionNumber + 1} تتفتح`)}</CardTitle>
        <CardDescription>{L('What a student must finish in this session first. Nothing ticked = the next session opens as usual. Later sessions wait too (no skipping).', 'الطالب لازم يخلّص إيه في الحصة دي الأول. من غير علامات = الحصة اللي بعدها بتتفتح عادي. والحصص اللي بعدها كمان بتستنى (مفيش تخطّي).')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={!!f.content} onChange={(e) => setF({ ...f, content: e.target.checked })} /> {L('Finish every part of the lesson', 'يخلّص كل أجزاء الدرس')}</label>
        <div className={`space-y-1 ${hasHomework ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={!!f.homework} onChange={(e) => setF({ ...f, homework: e.target.checked ? 'SUBMITTED' : null, minHomeworkPct: null })} /> {L('The homework', 'الواجب')}{!hasHomework && <span className="text-xs text-slate-400">{L(' (this session has no homework yet)', ' (الحصة دي لسه مفيهاش واجب)')}</span>}</label>
          {f.homework && (
            <div className="ms-6 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1"><input type="radio" name={`hw-${sessionId}`} disabled={!canEdit} checked={f.homework === 'SUBMITTED'} onChange={() => setF({ ...f, homework: 'SUBMITTED', minHomeworkPct: null })} /> {L('handed in', 'يتسلّم')}</label>
              <label className="flex items-center gap-1"><input type="radio" name={`hw-${sessionId}`} disabled={!canEdit} checked={f.homework === 'GRADED'} onChange={() => setF({ ...f, homework: 'GRADED' })} /> {L('graded by the instructor', 'يتصحح من المدرب')}</label>
              {f.homework === 'GRADED' && <label className="flex items-center gap-1">{L('lowest score %', 'أقل درجة %')} <Input type="number" min={0} max={100} className="h-8 w-20" disabled={!canEdit} value={f.minHomeworkPct ?? ''} placeholder={L('any', 'أي')} onChange={(e) => setF({ ...f, minHomeworkPct: num(e.target.value) })} /></label>}
            </div>
          )}
        </div>
        <div className={`space-y-1 ${hasQuiz ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={!!f.quiz} onChange={(e) => setF({ ...f, quiz: e.target.checked, minQuizPct: null })} /> {L('Pass the session quiz', 'ينجح في امتحان الحصة')}{!hasQuiz && <span className="text-xs text-slate-400">{L(' (this session has no quiz yet)', ' (الحصة دي لسه مفيهاش امتحان)')}</span>}</label>
          {f.quiz && <label className="ms-6 flex items-center gap-1">{L('lowest score % (empty = the quiz pass mark)', 'أقل درجة % (فاضي = درجة نجاح الامتحان)')} <Input type="number" min={0} max={100} className="h-8 w-20" disabled={!canEdit} value={f.minQuizPct ?? ''} onChange={(e) => setF({ ...f, minQuizPct: num(e.target.value) })} /></label>}
        </div>
        <p className="text-xs text-slate-500">{L('If grading is late, whether the student waits is set in LMS settings. Instructors can open a lesson for one student if LMS settings allow it.', 'لو التصحيح اتأخر، الطالب يستنى ولا لأ ده من إعدادات المنصة. والمدرب يقدر يفتح الدرس لطالب معيّن لو الإعدادات سامحة.')}</p>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(any ? f : null)}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'حفظ')}</Button>
            {gate && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setF({ content: false, homework: null, minHomeworkPct: null, quiz: false, minQuizPct: null }); save.mutate(null) }}>{L('Remove the condition', 'شيل الشرط')}</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
