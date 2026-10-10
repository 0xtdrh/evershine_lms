'use client'

/**
 * LMS L3 batch 2: code editor + runner in the student's browser (nothing runs on our server).
 * Python = Pyodide (WebAssembly) in a Web Worker; JavaScript = a Web Worker without page access. Each run has a time
 * limit (the worker is killed). Arduino = text checks only (no compiler), via lib/assignments/tool-checks.
 * Results of the author's tests go with the hand-in; the instructor confirms them (a browser can be tampered with).
 */

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { analyzeArduino, evaluateRules, TOOL_RULES, type ToolCheck } from '@/lib/assignments/tool-checks'
import { CheckCircle2, Loader2, Play, ListChecks, XCircle } from 'lucide-react'

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js'

const PY_WORKER = `
importScripts('${PYODIDE}');
let py = null;
self.onmessage = async (e) => {
  const { id, code, input } = e.data;
  let out = '';
  try {
    if (!py) py = await loadPyodide();
    py.setStdout({ batched: (s) => { out += s + '\\n' } });
    py.setStderr({ batched: (s) => { out += s + '\\n' } });
    const lines = String(input || '').split('\\n'); let i = 0;
    py.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) });
    await py.runPythonAsync(code);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, out: out + String((err && err.message) || err).split('\\n').slice(-3).join('\\n') });
  }
};`

const JS_WORKER = `
self.onmessage = (e) => {
  const { id, code, input } = e.data;
  let out = '';
  const lines = String(input || '').split('\\n'); let i = 0;
  const log = (...a) => { out += a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\\n' };
  const con = { log, error: log, warn: log, info: log };
  const readLine = () => (i < lines.length ? lines[i++] : '');
  try {
    new Function('console', 'prompt', 'readLine', 'fetch', 'XMLHttpRequest', 'importScripts', code)(con, readLine, readLine, undefined, undefined, undefined);
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, out: out + String((err && err.message) || err) });
  }
};`

export interface TestCase { id: string; input: string; expected: string; points: number }
export interface TestResult { id: string; passed: boolean; output: string }

export const normalizeOutput = (s: string) => String(s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').trim()

/** Runs code in a throw-away worker (one per runner instance, recreated after a timeout). */
export function useCodeRunner(language: 'python' | 'javascript' | 'arduino') {
  const worker = useRef<Worker | null>(null)
  const warm = useRef(false)
  const make = () => {
    const src = language === 'python' ? PY_WORKER : JS_WORKER
    worker.current = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    warm.current = false
  }
  useEffect(() => () => worker.current?.terminate(), [])
  const run = (code: string, input: string): Promise<{ ok: boolean; out: string; timeout?: boolean }> =>
    new Promise((resolve) => {
      if (language === 'arduino') return resolve({ ok: true, out: '' })
      if (!worker.current) make()
      const w = worker.current!
      const id = Math.random().toString(36).slice(2)
      const limit = language === 'python' && !warm.current ? 45_000 : 6_000 // first Python run downloads Pyodide
      const timer = setTimeout(() => { w.terminate(); worker.current = null; resolve({ ok: false, out: 'Time limit reached (endless loop?)', timeout: true }) }, limit)
      w.onmessage = (e) => { if (e.data.id !== id) return; clearTimeout(timer); warm.current = true; resolve({ ok: e.data.ok, out: e.data.out }) }
      w.postMessage({ id, code, input })
    })
  const runTests = async (code: string, tests: TestCase[]): Promise<TestResult[]> => {
    const out: TestResult[] = []
    for (const t of tests) {
      const r = await run(code, t.input)
      out.push({ id: t.id, passed: r.ok && normalizeOutput(r.out) === normalizeOutput(t.expected), output: r.out.slice(0, 500) })
    }
    return out
  }
  return { run, runTests }
}

export function CodeEditor({ value, onChange, disabled, language }: { value: string; onChange: (v: string) => void; disabled?: boolean; language: string }) {
  const lines = Math.max(8, value.split('\n').length + 1)
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-slate-900" dir="ltr">
      <pre className="select-none bg-slate-800 px-2 py-2 text-right font-mono text-xs leading-5 text-slate-500">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
      <textarea
        spellCheck={false} disabled={disabled} value={value} aria-label={`${language} code`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          e.preventDefault()
          const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd
          onChange(value.slice(0, a) + '    ' + value.slice(b))
          requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 4 })
        }}
        style={{ height: `${lines * 20 + 16}px` }}
        className="w-full resize-none bg-transparent p-2 font-mono text-xs leading-5 text-slate-100 outline-none"
      />
    </div>
  )
}

/** Editor + run + tests (Python / JS) or text checks (Arduino) for a student's homework. */
export function CodeWork({ language, code, onCode, tests, toolCheck, disabled, results, onResults }: {
  language: 'python' | 'javascript' | 'arduino'; code: string; onCode: (v: string) => void; tests: TestCase[]
  toolCheck?: ToolCheck | null; disabled?: boolean; results: TestResult[] | null; onResults: (r: TestResult[]) => void
}) {
  const { t, pick } = useI18n()
  const { run, runTests } = useCodeRunner(language)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const arduino = language === 'arduino' ? analyzeArduino(code) : null
  const ardRules = arduino && toolCheck?.tool === 'ARDUINO' ? evaluateRules(toolCheck, arduino) : null
  const label = (kind: string) => { const r = TOOL_RULES.ARDUINO.find((x) => x.kind === kind); return r ? pick(r.labelEn, r.labelAr) : kind }

  return (
    <div className="space-y-2">
      <CodeEditor value={code} onChange={onCode} disabled={disabled} language={language} />
      {language !== 'arduino' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <textarea dir="ltr" className="h-9 min-w-[160px] flex-1 rounded-md border border-slate-200 bg-white p-1 font-mono text-xs" placeholder={t('code.input')} value={input} onChange={(e) => setInput(e.target.value)} />
            <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy} onClick={async () => { setBusy(true); const r = await run(code, input); setOutput(r.out || (r.ok ? '' : 'Error')); setBusy(false) }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {t('code.run')}
            </Button>
            {tests.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy} onClick={async () => { setBusy(true); onResults(await runTests(code, tests)); setBusy(false) }}>
                <ListChecks className="h-4 w-4" /> {t('code.runTests')}
              </Button>
            )}
          </div>
          {output !== null && <pre dir="ltr" className="max-h-48 overflow-auto rounded-lg bg-slate-100 p-2 font-mono text-xs text-slate-800">{output || '(no output)'}</pre>}
          {results && (
            <div className="space-y-1">
              {tests.map((tc, i) => {
                const r = results.find((x) => x.id === tc.id)
                return (
                  <div key={tc.id} className="flex items-start gap-2 text-xs" dir="ltr">
                    {r?.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
                    <span>Test {i + 1}{tc.input ? ` · input: ${tc.input.replace(/\n/g, ' ⏎ ')}` : ''} · expected: <b>{tc.expected}</b>{r && !r.passed ? ` · got: ${normalizeOutput(r.output).slice(0, 80) || '—'}` : ''} ({tc.points})</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1 rounded-lg border border-slate-200 p-2 text-xs">
          <p className="font-semibold text-slate-600">{t('code.arduinoCheck')}</p>
          {ardRules ? ardRules.detail.map((d) => (
            <p key={d.id} className="flex items-center gap-1">{d.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} {label(d.kind)}</p>
          )) : (
            <>
              <p className="flex items-center gap-1">{arduino?.names.has('setup+loop') ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} setup() + loop()</p>
              <p className="flex items-center gap-1">{arduino?.balanced ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} {label('BALANCED')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
