'use client'

/** LMS L4: code shown in a question — light syntax colours (Python / JavaScript / Arduino), line numbers, clickable lines (find the bug). */

const KEYWORDS: Record<string, string[]> = {
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'and', 'or', 'not', 'import', 'from', 'as', 'class', 'True', 'False', 'None', 'print', 'range', 'len', 'input', 'int', 'str', 'float', 'break', 'continue', 'pass', 'try', 'except', 'lambda', 'with'],
  javascript: ['function', 'return', 'if', 'else', 'for', 'while', 'let', 'const', 'var', 'true', 'false', 'null', 'undefined', 'console', 'new', 'class', 'of', 'in', 'break', 'continue', 'try', 'catch', 'typeof'],
  arduino: ['void', 'int', 'float', 'bool', 'boolean', 'char', 'long', 'const', 'return', 'if', 'else', 'for', 'while', 'setup', 'loop', 'pinMode', 'digitalWrite', 'digitalRead', 'analogWrite', 'analogRead', 'delay', 'Serial', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'true', 'false'],
}

type Tok = { t: string; c: string }

function tokenize(line: string, lang: string): Tok[] {
  const kw = new Set(KEYWORDS[lang] ?? [])
  const out: Tok[] = []
  const comment = lang === 'python' ? '#' : '//'
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    if (rest.startsWith(comment)) { out.push({ t: rest, c: 'text-slate-400 italic' }); break }
    const str = rest.match(/^("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)/)
    if (str) { out.push({ t: str[0], c: 'text-amber-300' }); i += str[0].length; continue }
    const num = rest.match(/^\d+(\.\d+)?/)
    if (num) { out.push({ t: num[0], c: 'text-sky-300' }); i += num[0].length; continue }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (word) { out.push({ t: word[0], c: kw.has(word[0]) ? 'text-fuchsia-300 font-semibold' : 'text-slate-100' }); i += word[0].length; continue }
    out.push({ t: rest[0], c: rest[0] === '_' ? 'text-slate-100' : 'text-slate-300' })
    i++
  }
  return out
}

export function CodeBlock({ code, language = 'python', onLine, selectedLine, mark }: { code: string; language?: string; onLine?: (n: number) => void; selectedLine?: number | null; mark?: { line: number; ok: boolean } | null }) {
  const lines = code.replace(/\r/g, '').split('\n')
  return (
    <pre dir="ltr" className="overflow-x-auto rounded-lg bg-slate-900 py-2 font-mono text-xs leading-6 select-none">
      {lines.map((l, i) => {
        const n = i + 1
        const sel = selectedLine === n
        const mk = mark?.line === n ? (mark.ok ? 'bg-emerald-700/50' : 'bg-rose-700/50') : ''
        return (
          <div key={i} onClick={onLine ? () => onLine(n) : undefined}
            className={`flex px-2 ${onLine ? 'cursor-pointer hover:bg-slate-700/60' : ''} ${sel ? 'bg-indigo-700/60' : ''} ${mk}`}>
            <span className="w-8 shrink-0 select-none pe-3 text-right text-slate-500">{n}</span>
            <span className="whitespace-pre">{tokenize(l, language).map((t, k) => <span key={k} className={t.c}>{t.t}</span>)}{!l && ' '}</span>
          </div>
        )
      })}
    </pre>
  )
}
