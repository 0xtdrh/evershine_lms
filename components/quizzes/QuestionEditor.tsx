'use client'

/** LMS L4: author form of one quiz question (any type), used in the quiz block editor and the question bank. */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import { CodeBlock } from './CodeBlock'

export type Q = {
  id: string; type: string; textEn: string; textAr: string; points: number; code?: string; language?: string; starter?: string
  options: { id: string; textEn: string; textAr: string; code?: string }[]; correct: (string | number)[]; tolerance?: number
  items: { id: string; textEn: string; textAr: string }[]; pairs: { id: string; left: string; right: string }[]
  tests: { id: string; input: string; expected: string; points: number }[]
}

export const TYPE_LABELS: Record<string, string> = {
  SINGLE: 'One correct choice', MULTI: 'Several correct choices', TRUE_FALSE: 'True / false', NUMBER: 'Number', SHORT: 'Short answer',
  PICTURE: 'Picture choice (young children)', ORDER: 'Put in order', MATCH: 'Match pairs',
  CODE_OUTPUT: 'Code: what does it print?', CODE_VALUE: 'Code: value of a variable at the end', FIND_BUG: 'Code: find the line with the mistake',
  FILL_BLANK: 'Code: fill the blank(s) ___', PARSONS: 'Code: put the lines in order', CHOOSE_CODE: 'Code: choose the right code',
  MATCH_CODE: 'Code: match code ↔ output', ERROR_MEANING: 'Code: what does the error mean?', WRITE_CODE: 'Code: write it (tests, instructor confirms)',
}
const uid = () => Math.random().toString(36).slice(2, 10)
const area = 'w-full rounded-md border border-slate-200 bg-white p-2 text-xs'
const CHOICE_TYPES = ['SINGLE', 'MULTI', 'PICTURE', 'CHOOSE_CODE', 'ERROR_MEANING']
const CODE_SHOWN = ['CODE_OUTPUT', 'CODE_VALUE', 'FIND_BUG', 'FILL_BLANK', 'ERROR_MEANING']

export function blankQuestion(type = 'SINGLE'): Q {
  return { id: uid(), type, textEn: '', textAr: '', points: 1, language: 'python', options: CHOICE_TYPES.includes(type) ? [{ id: uid(), textEn: '', textAr: '' }, { id: uid(), textEn: '', textAr: '' }] : [], correct: [], items: [], pairs: [], tests: [] }
}

export function QuestionEditor({ q, onChange, onRemove, index }: { q: Q; onChange: (q: Q) => void; onRemove?: () => void; index?: number }) {
  const set = (p: Partial<Q>) => onChange({ ...q, ...p })
  const isChoice = CHOICE_TYPES.includes(q.type)
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {index !== undefined && <span className="text-xs font-bold text-slate-500">Q{index + 1}</span>}
        <Select value={q.type} onValueChange={(t) => onChange({ ...blankQuestion(t), id: q.id, textEn: q.textEn, textAr: q.textAr, points: q.points, code: q.code, language: q.language })}>
          <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(TYPE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-1 text-xs">Points <Input type="number" min={0} className="h-8 w-16" value={q.points} onChange={(e) => set({ points: Number(e.target.value) || 0 })} /></label>
        {(CODE_SHOWN.includes(q.type) || ['PARSONS', 'CHOOSE_CODE', 'MATCH_CODE', 'WRITE_CODE'].includes(q.type)) && (
          <Select value={q.language ?? 'python'} onValueChange={(l) => set({ language: l })}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="python">Python</SelectItem><SelectItem value="javascript">JavaScript</SelectItem><SelectItem value="arduino">Arduino</SelectItem><SelectItem value="text">Text</SelectItem></SelectContent>
          </Select>
        )}
        {onRemove && <button type="button" className="ms-auto text-rose-600" aria-label="Remove question" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Question (English)" value={q.textEn} onChange={(e) => set({ textEn: e.target.value })} />
        <Input dir="rtl" placeholder="السؤال (عربي)" value={q.textAr} onChange={(e) => set({ textAr: e.target.value })} />
      </div>

      {CODE_SHOWN.includes(q.type) && (
        <div className="space-y-1">
          <textarea dir="ltr" className={`${area} min-h-[100px] font-mono`} placeholder={q.type === 'FILL_BLANK' ? 'Code with ___ where the student fills in' : q.type === 'ERROR_MEANING' ? 'The error message (and the code, optional)' : 'Code shown to the student'} value={q.code ?? ''} onChange={(e) => set({ code: e.target.value })} />
          {q.code && <CodeBlock code={q.code} language={q.language} selectedLine={q.type === 'FIND_BUG' ? Number(q.correct[0]) || null : null} onLine={q.type === 'FIND_BUG' ? (n) => set({ correct: [n] }) : undefined} />}
          {q.type === 'FIND_BUG' && <p className="text-[10px] text-slate-500">Click the line that has the mistake ({q.correct[0] ? `line ${q.correct[0]}` : 'none chosen'}).</p>}
        </div>
      )}

      {isChoice && (
        <div className="space-y-1">
          {q.options.map((o, k) => (
            <div key={o.id} className="flex items-start gap-2">
              <input className="mt-2" type={q.type === 'MULTI' ? 'checkbox' : 'radio'} name={`c-${q.id}`} title="Correct" checked={q.correct.includes(o.id)}
                onChange={(e) => set({ correct: q.type === 'MULTI' ? (e.target.checked ? [...q.correct, o.id] : q.correct.filter((x) => x !== o.id)) : [o.id] })} />
              {q.type === 'CHOOSE_CODE' ? (
                <textarea dir="ltr" className={`${area} h-20 flex-1 font-mono`} placeholder={`Code ${k + 1}`} value={o.code ?? ''} onChange={(e) => set({ options: q.options.map((x) => (x.id === o.id ? { ...x, code: e.target.value } : x)) })} />
              ) : (
                <>
                  <Input className="h-8" placeholder={q.type === 'PICTURE' ? `Picture ${k + 1} label / emoji (e.g. 🐱)` : `Choice ${k + 1}`} value={o.textEn} onChange={(e) => set({ options: q.options.map((x) => (x.id === o.id ? { ...x, textEn: e.target.value } : x)) })} />
                  <Input className="h-8" dir="rtl" placeholder={`اختيار ${k + 1}`} value={o.textAr} onChange={(e) => set({ options: q.options.map((x) => (x.id === o.id ? { ...x, textAr: e.target.value } : x)) })} />
                </>
              )}
              <button type="button" className="mt-2" aria-label="Remove choice" onClick={() => set({ options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((x) => x !== o.id) })}><Trash2 className="h-3 w-3 text-slate-400" /></button>
            </div>
          ))}
          <button type="button" className="text-xs text-indigo-600" onClick={() => set({ options: [...q.options, { id: uid(), textEn: '', textAr: '' }] })}>+ choice</button>
          <p className="text-[10px] text-slate-400">Tick the correct choice(s).</p>
        </div>
      )}

      {q.type === 'TRUE_FALSE' && (
        <Select value={String(q.correct[0] ?? '')} onValueChange={(v) => set({ correct: [v] })}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Correct answer" /></SelectTrigger>
          <SelectContent><SelectItem value="true">True / صح</SelectItem><SelectItem value="false">False / خطأ</SelectItem></SelectContent>
        </Select>
      )}
      {(q.type === 'NUMBER' || q.type === 'CODE_VALUE') && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-48" placeholder={q.type === 'CODE_VALUE' ? 'Correct value (number or text)' : 'Correct number'} value={q.correct[0] ?? ''} onChange={(e) => set({ correct: e.target.value === '' ? [] : [e.target.value] })} />
          <Input className="h-8 w-28" type="number" placeholder="± tolerance" value={q.tolerance ?? ''} onChange={(e) => set({ tolerance: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </div>
      )}
      {q.type === 'SHORT' && <Input className="h-8" placeholder="Accepted answers, separated by | " value={q.correct.join(' | ')} onChange={(e) => set({ correct: e.target.value.split('|').map((x) => x.trim()).filter(Boolean) })} />}
      {q.type === 'CODE_OUTPUT' && <textarea dir="ltr" className={`${area} h-20 font-mono`} placeholder="Exact output (each printed line on its own line)" value={String(q.correct[0] ?? '')} onChange={(e) => set({ correct: e.target.value ? [e.target.value] : [] })} />}
      {q.type === 'FILL_BLANK' && (
        <div className="space-y-1">
          {Array.from({ length: Math.max(1, (q.code?.match(/___/g) ?? []).length) }, (_, i) => (
            <Input key={i} className="h-8" placeholder={`Blank ${i + 1}: accepted answers separated by |`} value={String(q.correct[i] ?? '')} onChange={(e) => { const c = [...q.correct]; c[i] = e.target.value; set({ correct: c }) }} />
          ))}
        </div>
      )}
      {(q.type === 'ORDER' || q.type === 'PARSONS') && (
        <div className="space-y-1">
          <p className="text-[10px] text-slate-500">Write the items in the CORRECT order; students see them mixed.</p>
          {q.items.map((it, k) => (
            <div key={it.id} className="flex items-center gap-2">
              <span className="w-5 text-xs text-slate-400">{k + 1}.</span>
              <Input className={`h-8 ${q.type === 'PARSONS' ? 'font-mono' : ''}`} dir={q.type === 'PARSONS' ? 'ltr' : undefined} value={it.textEn} onChange={(e) => set({ items: q.items.map((x) => (x.id === it.id ? { ...x, textEn: e.target.value } : x)) })} />
              {q.type === 'ORDER' && <Input className="h-8" dir="rtl" placeholder="عربي" value={it.textAr} onChange={(e) => set({ items: q.items.map((x) => (x.id === it.id ? { ...x, textAr: e.target.value } : x)) })} />}
              <button type="button" aria-label="Remove" onClick={() => set({ items: q.items.filter((x) => x.id !== it.id) })}><Trash2 className="h-3 w-3 text-slate-400" /></button>
            </div>
          ))}
          <button type="button" className="text-xs text-indigo-600" onClick={() => set({ items: [...q.items, { id: uid(), textEn: '', textAr: '' }] })}>+ {q.type === 'PARSONS' ? 'line' : 'item'}</button>
        </div>
      )}
      {(q.type === 'MATCH' || q.type === 'MATCH_CODE') && (
        <div className="space-y-1">
          {q.pairs.map((p) => (
            <div key={p.id} className="flex items-start gap-2">
              <textarea dir={q.type === 'MATCH_CODE' ? 'ltr' : undefined} className={`${area} h-10 flex-1 ${q.type === 'MATCH_CODE' ? 'font-mono' : ''}`} placeholder={q.type === 'MATCH_CODE' ? 'code' : 'left'} value={p.left} onChange={(e) => set({ pairs: q.pairs.map((x) => (x.id === p.id ? { ...x, left: e.target.value } : x)) })} />
              <span className="pt-2">↔</span>
              <textarea className={`${area} h-10 flex-1`} placeholder={q.type === 'MATCH_CODE' ? 'output' : 'right'} value={p.right} onChange={(e) => set({ pairs: q.pairs.map((x) => (x.id === p.id ? { ...x, right: e.target.value } : x)) })} />
              <button type="button" className="pt-2" aria-label="Remove" onClick={() => set({ pairs: q.pairs.filter((x) => x.id !== p.id) })}><Trash2 className="h-3 w-3 text-slate-400" /></button>
            </div>
          ))}
          <button type="button" className="text-xs text-indigo-600" onClick={() => set({ pairs: [...q.pairs, { id: uid(), left: '', right: '' }] })}>+ pair</button>
        </div>
      )}
      {q.type === 'WRITE_CODE' && (
        <div className="space-y-1">
          <textarea dir="ltr" className={`${area} h-16 font-mono`} placeholder="Starting code (optional)" value={q.starter ?? ''} onChange={(e) => set({ starter: e.target.value })} />
          {q.tests.map((t, i) => (
            <div key={t.id} className="flex items-start gap-2">
              <span className="pt-2 text-xs text-slate-400">T{i + 1}</span>
              <textarea dir="ltr" className={`${area} h-12 flex-1 font-mono`} placeholder="input" value={t.input} onChange={(e) => set({ tests: q.tests.map((x) => (x.id === t.id ? { ...x, input: e.target.value } : x)) })} />
              <textarea dir="ltr" className={`${area} h-12 flex-1 font-mono`} placeholder="expected output" value={t.expected} onChange={(e) => set({ tests: q.tests.map((x) => (x.id === t.id ? { ...x, expected: e.target.value } : x)) })} />
              <button type="button" className="pt-2" aria-label="Remove" onClick={() => set({ tests: q.tests.filter((x) => x.id !== t.id) })}><Trash2 className="h-3 w-3 text-slate-400" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => set({ tests: [...q.tests, { id: uid(), input: '', expected: '', points: 1 }] })}><Plus className="h-3 w-3" /> Test</Button>
          <p className="text-[10px] text-slate-400">Tests run in the student&apos;s browser; you confirm the points in the quiz results. Not for Arduino.</p>
        </div>
      )}
    </div>
  )
}

/** Make the editor's shape fit the server schema (numbers, empty strings). */
export function cleanQuestion(q: Q): Q {
  const correct = (q.type === 'FIND_BUG' ? q.correct.map(Number) : q.type === 'NUMBER' ? q.correct.map((c) => Number(c)) : q.correct).filter((c) => c !== '' && c !== undefined && !(typeof c === 'number' && Number.isNaN(c)))
  return { ...q, correct, language: q.language ?? 'python' }
}
