'use client'

/** LMS L4: author form of a QUIZ block — kind (session / final), questions, random questions from the bank, settings. */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus } from 'lucide-react'
import { QuestionEditor, blankQuestion, cleanQuestion, type Q } from './QuestionEditor'

export function blankQuiz() {
  return { kind: 'SESSION', instructionsEn: '', instructionsAr: '', questions: [blankQuestion()], bank: null, timeLimitMin: 0, attempts: null, scoring: 'BEST', shuffleQuestions: true, shuffleOptions: true, passMark: 50, showAnswers: 'AFTER_CLOSE', requireInstructorOpen: null, allowPaper: true }
}

/** Before saving: question shapes cleaned for the server. */
export const cleanQuiz = (d: Record<string, unknown>) => ({ ...d, questions: ((d.questions as Q[]) ?? []).map(cleanQuestion) })

export function QuizForm({ data, onChange }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  const set = (p: Record<string, unknown>) => onChange({ ...data, ...p })
  const qs = (data.questions as Q[]) ?? []
  const bank = data.bank as { count: number; levelOnly: boolean; difficulty?: number | null } | null
  const isFinal = data.kind === 'FINAL'
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={(data.kind as string) ?? 'SESSION'} onValueChange={(v) => set({ kind: v })}>
          <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="SESSION">Session quiz (fills the &quot;task&quot; score)</SelectItem>
            <SelectItem value="FINAL">End-of-level exam (fills the &quot;MCQ&quot; score)</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">Time limit <Input type="number" min={0} className="h-8 w-16" value={(data.timeLimitMin as number) ?? 0} onChange={(e) => set({ timeLimitMin: Number(e.target.value) || 0 })} /> min (0 = none)</label>
        <label className="flex items-center gap-1 text-xs">Tries <Input type="number" min={1} max={10} className="h-8 w-16" placeholder={isFinal ? '1' : '2'} value={(data.attempts as number | null) ?? ''} onChange={(e) => set({ attempts: e.target.value ? Number(e.target.value) : null })} /></label>
        <Select value={(data.scoring as string) ?? 'BEST'} onValueChange={(v) => set({ scoring: v })}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="BEST">Best try counts</SelectItem><SelectItem value="LAST">Last try counts</SelectItem><SelectItem value="AVERAGE">Average of tries</SelectItem></SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">Pass mark <Input type="number" min={0} max={100} className="h-8 w-16" value={(data.passMark as number) ?? 50} onChange={(e) => set({ passMark: Number(e.target.value) || 0 })} />%</label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={data.shuffleQuestions !== false} onChange={(e) => set({ shuffleQuestions: e.target.checked })} /> Mix the questions</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={data.shuffleOptions !== false} onChange={(e) => set({ shuffleOptions: e.target.checked })} /> Mix the choices</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={(data.requireInstructorOpen as boolean | null) ?? isFinal} onChange={(e) => set({ requireInstructorOpen: e.target.checked })} /> The instructor opens it in class</label>
        {isFinal && <label className="flex items-center gap-1"><input type="checkbox" checked={data.allowPaper !== false} onChange={(e) => set({ allowPaper: e.target.checked })} /> Can be done on paper (typed score + scan)</label>}
        <label className="flex items-center gap-1">Show correct answers
          <Select value={(data.showAnswers as string) ?? 'AFTER_CLOSE'} onValueChange={(v) => set({ showAnswers: v })}>
            <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="NEVER">Never</SelectItem><SelectItem value="AFTER_SUBMIT">Right after handing in</SelectItem><SelectItem value="AFTER_CLOSE">When no tries are left / the quiz is closed</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea className="min-h-[60px] rounded-md border border-slate-200 bg-white p-2 text-xs" placeholder="Instructions (English)" value={(data.instructionsEn as string) ?? ''} onChange={(e) => set({ instructionsEn: e.target.value })} />
        <textarea className="min-h-[60px] rounded-md border border-slate-200 bg-white p-2 text-xs" dir="rtl" placeholder="التعليمات (عربي)" value={(data.instructionsAr as string) ?? ''} onChange={(e) => set({ instructionsAr: e.target.value })} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!bank} onChange={(e) => set({ bank: e.target.checked ? { count: 5, levelOnly: true, difficulty: null } : null })} /> Add random questions from the question bank</label>
        {bank && (
          <>
            <Input type="number" min={1} max={100} className="h-8 w-16" value={bank.count} onChange={(e) => set({ bank: { ...bank, count: Number(e.target.value) || 1 } })} /> questions
            <label className="flex items-center gap-1"><input type="checkbox" checked={bank.levelOnly} onChange={(e) => set({ bank: { ...bank, levelOnly: e.target.checked } })} /> this level only</label>
            <Select value={String(bank.difficulty ?? 'ANY')} onValueChange={(v) => set({ bank: { ...bank, difficulty: v === 'ANY' ? null : Number(v) } })}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ANY">Any difficulty</SelectItem><SelectItem value="1">Easy</SelectItem><SelectItem value="2">Medium</SelectItem><SelectItem value="3">Hard</SelectItem></SelectContent>
            </Select>
            <span className="text-slate-400">(each student gets a different draw)</span>
          </>
        )}
      </div>

      <div className="space-y-2">
        {qs.map((q, i) => <QuestionEditor key={q.id} q={q} index={i} onChange={(nq) => set({ questions: qs.map((x) => (x.id === q.id ? nq : x)) })} onRemove={() => set({ questions: qs.filter((x) => x.id !== q.id) })} />)}
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => set({ questions: [...qs, blankQuestion()] })}><Plus className="h-4 w-4" /> Question</Button>
      </div>
    </div>
  )
}
