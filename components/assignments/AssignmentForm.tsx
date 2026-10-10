'use client'

/** LMS L3: author form of an ASSIGNMENT block (curriculum editor): instructions, ways to hand in, questions, grading. */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { TOOLS, TOOL_RULES } from '@/lib/assignments/tool-checks'

type Q = { id: string; type: string; textEn: string; textAr: string; options: { id: string; textEn: string; textAr: string }[]; correct: (string | number)[]; tolerance?: number; points: number }
interface Rubric { id: string; nameEn: string; nameAr: string; criteria: unknown[]; kidStars: boolean; maxPoints: number }

export const KIND_LABELS: Record<string, string> = { TEXT: 'Written answer', FILE: 'File', PHOTO: 'Photos', VIDEO: 'Video', LINK: 'Link (Scratch, MakeCode, GitHub…)', IN_CLASS: 'Done in class (instructor ticks)', CODE: 'Code in the editor (Python / JavaScript / Arduino)' }
const TOOL_LABELS: Record<string, string> = { SCRATCH: 'Scratch (shared link or .sb3)', MAKECODE: 'MakeCode micro:bit / Arcade (shared link)', APPINVENTOR: 'App Inventor (.aia file)', SNAP: 'Snap! (public link or .xml)', GITHUB: 'GitHub (public repository link)', ARDUINO: 'Arduino code (editor or .ino)' }
const Q_LABELS: Record<string, string> = { SINGLE: 'One correct choice', MULTI: 'Several correct choices', TRUE_FALSE: 'True / false', NUMBER: 'Number', SHORT: 'Short answer (word)' }
const uid = () => Math.random().toString(36).slice(2, 10)
const area = 'min-h-[110px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm'

export function blankAssignment() {
  return { instructionsEn: '', instructionsAr: '', kinds: ['PHOTO'], questions: [], scale: 'POINTS', maxPoints: 10, rubricId: null, rubric: null, gradingMode: 'MANUAL', finalProject: false }
}

export function AssignmentForm({ data, onChange, subjectId }: { data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void; subjectId?: string }) {
  const set = (p: Record<string, unknown>) => onChange({ ...data, ...p })
  const kinds = (data.kinds as string[]) ?? []
  const questions = (data.questions as Q[]) ?? []
  const { data: rubrics } = useQuery({ queryKey: ['rubrics', subjectId], queryFn: () => fetchApi<Rubric[]>(`/api/rubrics${subjectId ? `?subjectId=${subjectId}` : ''}`) })
  const setQ = (i: number, p: Partial<Q>) => set({ questions: questions.map((q, j) => (j === i ? { ...q, ...p } : q)) })
  const addQ = () => set({ questions: [...questions, { id: uid(), type: 'SINGLE', textEn: '', textAr: '', options: [{ id: uid(), textEn: '', textAr: '' }, { id: uid(), textEn: '', textAr: '' }], correct: [], points: 1 }] })

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea className={area} placeholder="What to do (English, markdown)" value={(data.instructionsEn as string) ?? ''} onChange={(e) => set({ instructionsEn: e.target.value })} />
        <textarea className={area} dir="rtl" placeholder="المطلوب (عربي)" value={(data.instructionsAr as string) ?? ''} onChange={(e) => set({ instructionsAr: e.target.value })} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-slate-500">How students hand in (instructor grades these)</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <label key={k} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => set({ kinds: e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k) })} /> {l}</label>
          ))}
        </div>
      </div>

      {kinds.includes('CODE') && <CodeConfig data={data} set={set} />}
      <ToolConfig data={data} set={set} />

      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">Questions (graded automatically)</p><Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addQ}><Plus className="h-3 w-3" /> Question</Button></div>
        {questions.map((q, i) => (
          <div key={q.id} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Q{i + 1}</span>
              <Select value={q.type} onValueChange={(t) => setQ(i, { type: t, correct: [], options: t === 'SINGLE' || t === 'MULTI' ? (q.options.length ? q.options : [{ id: uid(), textEn: '', textAr: '' }]) : [] })}>
                <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(Q_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs">Points <Input type="number" min={0} className="h-8 w-16" value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value) || 0 })} /></label>
              <button type="button" className="ms-auto text-rose-600" aria-label="Remove question" onClick={() => set({ questions: questions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Question (English)" value={q.textEn} onChange={(e) => setQ(i, { textEn: e.target.value })} />
              <Input dir="rtl" placeholder="السؤال (عربي)" value={q.textAr} onChange={(e) => setQ(i, { textAr: e.target.value })} />
            </div>
            {(q.type === 'SINGLE' || q.type === 'MULTI') && (
              <div className="space-y-1">
                {q.options.map((o, k) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <input type={q.type === 'SINGLE' ? 'radio' : 'checkbox'} name={`c-${q.id}`} checked={q.correct.includes(o.id)} title="Correct"
                      onChange={(e) => setQ(i, { correct: q.type === 'SINGLE' ? [o.id] : e.target.checked ? [...q.correct, o.id] : q.correct.filter((x) => x !== o.id) })} />
                    <Input className="h-8" placeholder={`Choice ${k + 1}`} value={o.textEn} onChange={(e) => setQ(i, { options: q.options.map((x) => (x.id === o.id ? { ...x, textEn: e.target.value } : x)) })} />
                    <Input className="h-8" dir="rtl" placeholder={`اختيار ${k + 1}`} value={o.textAr} onChange={(e) => setQ(i, { options: q.options.map((x) => (x.id === o.id ? { ...x, textAr: e.target.value } : x)) })} />
                    <button type="button" aria-label="Remove choice" onClick={() => setQ(i, { options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((x) => x !== o.id) })}><Trash2 className="h-3 w-3 text-slate-400" /></button>
                  </div>
                ))}
                <button type="button" className="text-xs text-indigo-600" onClick={() => setQ(i, { options: [...q.options, { id: uid(), textEn: '', textAr: '' }] })}>+ choice</button>
                <p className="text-[10px] text-slate-400">Tick the correct choice(s).</p>
              </div>
            )}
            {q.type === 'TRUE_FALSE' && (
              <Select value={String(q.correct[0] ?? '')} onValueChange={(v) => setQ(i, { correct: [v] })}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Correct answer" /></SelectTrigger>
                <SelectContent><SelectItem value="true">True / صح</SelectItem><SelectItem value="false">False / خطأ</SelectItem></SelectContent>
              </Select>
            )}
            {q.type === 'NUMBER' && (
              <div className="flex flex-wrap gap-2">
                <Input className="h-8 w-32" type="number" placeholder="Correct number" value={q.correct[0] ?? ''} onChange={(e) => setQ(i, { correct: e.target.value === '' ? [] : [Number(e.target.value)] })} />
                <Input className="h-8 w-32" type="number" placeholder="± tolerance" value={q.tolerance ?? ''} onChange={(e) => setQ(i, { tolerance: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
            )}
            {q.type === 'SHORT' && (
              <Input className="h-8" placeholder="Accepted answers, separated by | (e.g. 5 | five | خمسة)" value={q.correct.join(' | ')} onChange={(e) => setQ(i, { correct: e.target.value.split('|').map((x) => x.trim()).filter(Boolean) })} />
            )}
          </div>
        ))}
        {!questions.length && <p className="text-xs text-slate-400">No questions — only the instructor grades this assignment.</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-slate-500">Who grades</span>
          <Select value={(data.gradingMode as string) ?? 'MANUAL'} onValueChange={(v) => set({ gradingMode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">The instructor</SelectItem>
              <SelectItem value="AUTO">Automatic (questions) — final at once</SelectItem>
              <SelectItem value="AUTO_REVIEW">Automatic + the instructor confirms</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Instructor&apos;s part is graded with</span>
          <Select value={(data.scale as string) ?? 'POINTS'} onValueChange={(v) => set({ scale: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="POINTS">Points</SelectItem>
              <SelectItem value="RUBRIC">A rubric</SelectItem>
              <SelectItem value="STARS">Stars (0–3, young children)</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {data.scale === 'POINTS' && <label className="flex items-center gap-2 text-xs">Out of <Input type="number" min={1} className="h-8 w-20" value={(data.maxPoints as number) ?? 10} onChange={(e) => set({ maxPoints: Number(e.target.value) || 0 })} /> points</label>}
        {data.scale === 'RUBRIC' && (
          <label className="space-y-1"><span className="text-xs text-slate-500">Rubric (from the library — a copy is kept)</span>
            <Select value={(data.rubricId as string) ?? ''} onValueChange={(id) => { const r = rubrics?.find((x) => x.id === id); if (r) set({ rubricId: r.id, rubric: { nameEn: r.nameEn, nameAr: r.nameAr, criteria: r.criteria, kidStars: r.kidStars } }) }}>
              <SelectTrigger><SelectValue placeholder={rubrics?.length ? 'Choose a rubric' : 'No rubrics yet — add one in LMS settings'} /></SelectTrigger>
              <SelectContent>{(rubrics ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.nameEn} ({r.maxPoints} pts)</SelectItem>)}</SelectContent>
            </Select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!data.finalProject} onChange={(e) => set({ finalProject: e.target.checked })} /> Final project of the level (fills the &quot;project&quot; score)</label>
      </div>
    </div>
  )
}

type Test = { id: string; input: string; expected: string; points: number }
type Code = { language: string; starter: string; tests: Test[] }

function CodeConfig({ data, set }: { data: Record<string, unknown>; set: (p: Record<string, unknown>) => void }) {
  const code = (data.code as Code | null) ?? { language: 'python', starter: '', tests: [] }
  const setCode = (p: Partial<Code>) => set({ code: { ...code, ...p } })
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-slate-500">Code</p>
        <Select value={code.language} onValueChange={(v) => setCode({ language: v })}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="python">Python</SelectItem><SelectItem value="javascript">JavaScript</SelectItem><SelectItem value="arduino">Arduino (C++)</SelectItem></SelectContent>
        </Select>
      </div>
      <textarea dir="ltr" className="min-h-[90px] w-full rounded-md border border-slate-200 bg-white p-2 font-mono text-xs" placeholder="Starting code the student sees (optional)" value={code.starter} onChange={(e) => setCode({ starter: e.target.value })} />
      {code.language === 'arduino' ? (
        <p className="text-xs text-slate-500">Arduino code cannot run here: add &quot;Arduino code&quot; automatic checks below (setup/loop, brackets, functions used).</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Tests: what the program must print for an input (one value per line; Python <code>input()</code>, JavaScript <code>readLine()</code>). They run in the student&apos;s browser; you confirm the score.</p>
          {code.tests.map((t, i) => (
            <div key={t.id} className="flex flex-wrap items-start gap-2">
              <span className="pt-2 text-xs font-bold text-slate-500">T{i + 1}</span>
              <textarea dir="ltr" className="h-14 flex-1 rounded-md border border-slate-200 bg-white p-1 font-mono text-xs" placeholder="input" value={t.input} onChange={(e) => setCode({ tests: code.tests.map((x) => (x.id === t.id ? { ...x, input: e.target.value } : x)) })} />
              <textarea dir="ltr" className="h-14 flex-1 rounded-md border border-slate-200 bg-white p-1 font-mono text-xs" placeholder="expected output" value={t.expected} onChange={(e) => setCode({ tests: code.tests.map((x) => (x.id === t.id ? { ...x, expected: e.target.value } : x)) })} />
              <Input type="number" min={0} className="h-8 w-16" value={t.points} onChange={(e) => setCode({ tests: code.tests.map((x) => (x.id === t.id ? { ...x, points: Number(e.target.value) || 0 } : x)) })} />
              <button type="button" aria-label="Remove test" onClick={() => setCode({ tests: code.tests.filter((x) => x.id !== t.id) })}><Trash2 className="h-4 w-4 text-slate-400" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setCode({ tests: [...code.tests, { id: uid(), input: '', expected: '', points: 1 }] })}><Plus className="h-3 w-3" /> Test</Button>
        </div>
      )}
    </div>
  )
}

type Rule = { id: string; kind: string; value?: string | number | null; points: number }

function ToolConfig({ data, set }: { data: Record<string, unknown>; set: (p: Record<string, unknown>) => void }) {
  const tc = data.toolCheck as { tool: string; rules: Rule[] } | null | undefined
  const on = data.autoCheck !== false
  const [chosen, setChosen] = useState<string>(tc?.tool ?? 'SCRATCH')
  const tool = (tc?.tool ?? chosen) as keyof typeof TOOL_RULES
  const rules = tc?.rules ?? []
  const setRules = (rs: Rule[]) => set({ toolCheck: rs.length ? { tool, rules: rs } : null })
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-slate-500">Automatic project check</p>
        <Select value={tool} onValueChange={(v) => { setChosen(v); set({ toolCheck: null }) }}>
          <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TOOLS.map((t) => <SelectItem key={t} value={t}>{TOOL_LABELS[t]}</SelectItem>)}</SelectContent>
        </Select>
        {rules.length > 0 && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={on} onChange={(e) => set({ autoCheck: e.target.checked })} /> On</label>}
      </div>
      {rules.map((r) => {
        const def = TOOL_RULES[tool].find((x) => x.kind === r.kind)
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-2">
            <Select value={r.kind} onValueChange={(k) => setRules(rules.map((x) => (x.id === r.id ? { ...x, kind: k, value: null } : x)))}>
              <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{TOOL_RULES[tool].map((d) => <SelectItem key={d.kind} value={d.kind}>{d.labelEn}</SelectItem>)}</SelectContent>
            </Select>
            {def && def.param !== 'none' && <Input className="h-8 w-40" type={def.param === 'number' ? 'number' : 'text'} placeholder={def.param === 'number' ? 'N' : 'value'} value={r.value ?? ''} onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, value: def.param === 'number' ? Number(e.target.value) : e.target.value } : x)))} />}
            <label className="flex items-center gap-1 text-xs">Points <Input type="number" min={0} className="h-8 w-16" value={r.points} onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, points: Number(e.target.value) || 0 } : x)))} /></label>
            <button type="button" aria-label="Remove check" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}><Trash2 className="h-4 w-4 text-slate-400" /></button>
          </div>
        )
      })}
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setRules([...rules, { id: uid(), kind: TOOL_RULES[tool][0].kind, value: null, points: 1 }])}><Plus className="h-3 w-3" /> Check</Button>
      <p className="text-[10px] text-slate-400">The project must be shared / public (Scratch &quot;Share&quot;, MakeCode &quot;Share&quot;, Snap! &quot;Publish&quot;, a public GitHub repo) or uploaded as a file — add &quot;Link&quot; or &quot;File&quot; above. If the check cannot read the project, the instructor grades it.</p>
    </div>
  )
}
