'use client'

/** LMS L4: author form of a QUIZ block — kind (session / final), questions, random questions from the bank, settings. */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus } from 'lucide-react'
import { QuestionEditor, blankQuestion, cleanQuestion, type Q } from './QuestionEditor'
import { L } from '@/lib/i18n/client'

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
            <SelectItem value="SESSION">{L('Session quiz (fills the "task" score)', 'كويز حصة (بيملا خانة task)')}</SelectItem>
            <SelectItem value="FINAL">{L('End-of-level exam (fills the "MCQ" score)', 'امتحان آخر المستوى (بيملا خانة MCQ)')}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">{L('Time limit', 'الوقت')} <Input type="number" min={0} className="h-8 w-16" value={(data.timeLimitMin as number) ?? 0} onChange={(e) => set({ timeLimitMin: Number(e.target.value) || 0 })} /> {L('min (0 = none)', 'دقيقة (0 = من غير)')}</label>
        <label className="flex items-center gap-1 text-xs">{L('Tries', 'المحاولات')} <Input type="number" min={1} max={10} className="h-8 w-16" placeholder={isFinal ? '1' : '2'} value={(data.attempts as number | null) ?? ''} onChange={(e) => set({ attempts: e.target.value ? Number(e.target.value) : null })} /></label>
        <Select value={(data.scoring as string) ?? 'BEST'} onValueChange={(v) => set({ scoring: v })}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="BEST">{L('Best try counts', 'أحسن محاولة')}</SelectItem><SelectItem value="LAST">{L('Last try counts', 'آخر محاولة')}</SelectItem><SelectItem value="AVERAGE">{L('Average of tries', 'متوسط المحاولات')}</SelectItem></SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">{L('Pass mark', 'درجة النجاح')} <Input type="number" min={0} max={100} className="h-8 w-16" value={(data.passMark as number) ?? 50} onChange={(e) => set({ passMark: Number(e.target.value) || 0 })} />%</label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={data.shuffleQuestions !== false} onChange={(e) => set({ shuffleQuestions: e.target.checked })} /> {L('Mix the questions', 'اخلط الأسئلة')}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={data.shuffleOptions !== false} onChange={(e) => set({ shuffleOptions: e.target.checked })} /> {L('Mix the choices', 'اخلط الاختيارات')}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={(data.requireInstructorOpen as boolean | null) ?? isFinal} onChange={(e) => set({ requireInstructorOpen: e.target.checked })} /> {L('The instructor opens it in class', 'المدرب يفتحه في الحصة')}</label>
        {isFinal && <label className="flex items-center gap-1"><input type="checkbox" checked={data.allowPaper !== false} onChange={(e) => set({ allowPaper: e.target.checked })} /> {L('Can be done on paper (typed score + scan)', 'ينفع ورقي (درجة + سكان)')}</label>}
        <label className="flex items-center gap-1">{L('Show correct answers', 'إظهار الإجابات الصح')}
          <Select value={(data.showAnswers as string) ?? 'AFTER_CLOSE'} onValueChange={(v) => set({ showAnswers: v })}>
            <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="NEVER">{L('Never', 'أبدًا')}</SelectItem><SelectItem value="AFTER_SUBMIT">{L('Right after handing in', 'بعد التسليم على طول')}</SelectItem><SelectItem value="AFTER_CLOSE">{L('When no tries are left / the quiz is closed', 'لما المحاولات تخلص / الكويز يتقفل')}</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea className="min-h-[60px] rounded-md border border-slate-200 bg-white p-2 text-xs" placeholder={L('Instructions (English)', 'التعليمات (إنجليزي)')} value={(data.instructionsEn as string) ?? ''} onChange={(e) => set({ instructionsEn: e.target.value })} />
        <textarea className="min-h-[60px] rounded-md border border-slate-200 bg-white p-2 text-xs" dir="rtl" placeholder="التعليمات (عربي)" value={(data.instructionsAr as string) ?? ''} onChange={(e) => set({ instructionsAr: e.target.value })} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!bank} onChange={(e) => set({ bank: e.target.checked ? { count: 5, levelOnly: true, difficulty: null } : null })} /> {L('Add random questions from the question bank', 'ضيف أسئلة عشوائية من بنك الأسئلة')}</label>
        {bank && (
          <>
            <Input type="number" min={1} max={100} className="h-8 w-16" value={bank.count} onChange={(e) => set({ bank: { ...bank, count: Number(e.target.value) || 1 } })} /> {L('questions', 'سؤال')}
            <label className="flex items-center gap-1"><input type="checkbox" checked={bank.levelOnly} onChange={(e) => set({ bank: { ...bank, levelOnly: e.target.checked } })} /> {L('this level only', 'المستوى ده بس')}</label>
            <Select value={String(bank.difficulty ?? 'ANY')} onValueChange={(v) => set({ bank: { ...bank, difficulty: v === 'ANY' ? null : Number(v) } })}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ANY">{L('Any difficulty', 'أي صعوبة')}</SelectItem><SelectItem value="1">{L('Easy', 'سهل')}</SelectItem><SelectItem value="2">{L('Medium', 'متوسط')}</SelectItem><SelectItem value="3">{L('Hard', 'صعب')}</SelectItem></SelectContent>
            </Select>
            <span className="text-slate-400">{L('(each student gets a different draw)', '(كل طالب بياخد أسئلة مختلفة)')}</span>
          </>
        )}
      </div>

      <div className="space-y-2">
        {qs.map((q, i) => <QuestionEditor key={q.id} q={q} index={i} onChange={(nq) => set({ questions: qs.map((x) => (x.id === q.id ? nq : x)) })} onRemove={() => set({ questions: qs.filter((x) => x.id !== q.id) })} />)}
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => set({ questions: [...qs, blankQuestion()] })}><Plus className="h-4 w-4" /> {L('Question', 'سؤال')}</Button>
      </div>
    </div>
  )
}
