'use client'

/**
 * C15 (final test, 23/11): ONE confirmation window for the whole system, instead of the browser's window.confirm().
 * The app's built-in browser (and installed mobile apps) block window.confirm, so buttons that asked first did nothing,
 * and on a phone it looked foreign. Use:  if (!(await ask(L('Delete?', 'تمسح؟')))) return
 *
 * Phone: a sheet from the bottom (buttons within thumb reach, 44 px). Desktop: a small centred window.
 * Enter = yes, Escape / tap outside = no. Mounted once in app/layout.tsx (<ConfirmHost />).
 * Words like delete / remove / cancel / stop make the yes button red. Never throws; without the host it falls back to window.confirm.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

export interface AskOptions { yes?: string; no?: string; danger?: boolean; title?: string }
interface Pending { message: string; opts: AskOptions; resolve: (ok: boolean) => void }

let current: Pending | null = null
let mounted = 0
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

const DANGER = /delete|remove|cancel|stop|deactivat|suspend|withdraw|unlink|archive|reset|exclude|take .* out|امسح|تمسح|تشيل|شيل|تلغي|الغي|إلغاء|توقف|توقّف|تقفل|تسحب|تستبعد|نهائي/i

/** Asks a yes / no question in the system window. Resolves true for yes. */
export function ask(message: string, opts: AskOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (!mounted) return Promise.resolve(window.confirm(message)) // safety net only (host not on the page)
  if (current) current.resolve(false) // one question at a time: a new one answers the old one with "no"
  return new Promise<boolean>((resolve) => {
    current = { message, opts, resolve }
    emit()
  })
}

function answer(ok: boolean) {
  const p = current
  current = null
  emit()
  p?.resolve(ok)
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function ConfirmHost() {
  const p = useSyncExternalStore(subscribe, () => current, () => null)
  const yesRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { mounted++; return () => { mounted--; if (current) answer(false) } }, [])
  useEffect(() => {
    if (!p) return
    yesRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); answer(false) }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); answer(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  if (!p) return null
  const ar = typeof document !== 'undefined' && document.documentElement.lang === 'ar'
  const danger = p.opts.danger ?? DANGER.test(p.message)
  const yes = p.opts.yes ?? (ar ? 'أيوه، أكّد' : 'Yes, go ahead')
  const no = p.opts.no ?? (ar ? 'لأ، رجوع' : 'No, go back')
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[2px] animate-in fade-in duration-150 sm:items-center sm:p-4 print:hidden"
      dir={ar ? 'rtl' : 'ltr'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false) }}
    >
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="tn-confirm-msg"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom-6 duration-200 sm:rounded-2xl sm:pb-5 sm:zoom-in-95 sm:slide-in-from-bottom-0"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        {p.opts.title && <p className="mb-1 text-base font-bold text-slate-900">{p.opts.title}</p>}
        <p id="tn-confirm-msg" className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => answer(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98]">{no}</button>
          <button
            ref={yesRef} type="button" onClick={() => answer(true)}
            className={`min-h-11 rounded-xl px-4 text-sm font-bold text-white shadow active:scale-[0.98] ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >{yes}</button>
        </div>
      </div>
    </div>
  )
}
