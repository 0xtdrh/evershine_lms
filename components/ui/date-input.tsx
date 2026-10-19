'use client'

/**
 * 2026-10-19 (owner): every date is typed and shown as DAY / MONTH / YEAR (dd/mm/yyyy) — the browser's own date box
 * follows the computer's language (often month first), so it is replaced by this one everywhere.
 *
 * Drop-in for `<Input type="date">`: the real form value stays a hidden native date input (YYYY-MM-DD), so `value` /
 * `onChange` / `name` / react-hook-form `register()` keep working unchanged; the box you see shows dd/mm/yyyy, and the
 * calendar button opens the browser's picker.
 */

import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD → dd/mm/yyyy ('' when empty or invalid). */
export function isoToDmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** dd/mm/yyyy (also d-m-yyyy, Arabic digits) → YYYY-MM-DD, or null when it is not a real date. */
export function dmyToIso(text: string): string | null {
  const t = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim()
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(t)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** Adds the slashes while typing digits: 1910 → 19/10, 19102026 → 19/10/2026. */
function autoSlash(raw: string): string {
  const digits = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d/]/g, '')
  if (digits.includes('/')) return digits.slice(0, 10)
  const s = digits.slice(0, 8)
  if (s.length <= 2) return s
  if (s.length <= 4) return `${s.slice(0, 2)}/${s.slice(2)}`
  return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`
}

const nativeValueSetter = typeof window !== 'undefined' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set : undefined

export const DateInput = React.forwardRef<HTMLInputElement, Props>(function DateInput(
  { className, value, defaultValue, onChange, onBlur, disabled, placeholder, id, style, ...rest },
  ref,
) {
  const native = React.useRef<HTMLInputElement | null>(null)
  const controlled = value !== undefined
  const [text, setText] = React.useState(isoToDmy(String(value ?? defaultValue ?? '')))

  const setRefs = (el: HTMLInputElement | null) => {
    native.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el
  }

  // controlled: follow the value from the parent
  React.useEffect(() => { if (controlled) setText(isoToDmy(String(value ?? ''))) }, [controlled, value])
  // uncontrolled (react-hook-form): reset() sets the hidden input without an event — follow it
  React.useEffect(() => {
    if (controlled) return
    let last = native.current?.value ?? ''
    setText(isoToDmy(last))
    const t = window.setInterval(() => {
      const v = native.current?.value ?? ''
      if (v !== last) { last = v; setText(isoToDmy(v)) }
    }, 400)
    return () => window.clearInterval(t)
  }, [controlled])

  /** Writes YYYY-MM-DD into the hidden input the way a person would, so every onChange / register() sees it. */
  const commit = (iso: string) => {
    const el = native.current
    if (!el || el.value === iso) return
    nativeValueSetter?.call(el, iso)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return (
    <div className={cn('relative items-center', /(^|\s)(max-)?w-/.test(className ?? '') ? 'inline-flex' : 'flex w-full')} style={style}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        disabled={disabled}
        placeholder={placeholder ?? 'dd/mm/yyyy'}
        value={text}
        onChange={(e) => {
          const next = autoSlash(e.target.value)
          setText(next)
          if (!next) commit('')
          else { const iso = dmyToIso(next); if (iso) commit(iso) }
        }}
        onBlur={(e) => {
          // a half-typed date goes back to the last good one
          if (text && !dmyToIso(text)) setText(isoToDmy(native.current?.value))
          onBlur?.({ ...e, target: native.current ?? e.target } as React.FocusEvent<HTMLInputElement>)
        }}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pe-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Calendar"
        className="absolute end-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
        onClick={() => { try { native.current?.showPicker?.() } catch { native.current?.focus() } }}
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      <input
        {...rest}
        ref={setRefs}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        {...(controlled ? { value: String(value ?? '') } : defaultValue !== undefined ? { defaultValue } : {})}
        onChange={(e) => { setText(isoToDmy(e.target.value)); onChange?.(e) }}
        className="pointer-events-none absolute bottom-0 end-0 h-px w-px opacity-0"
      />
    </div>
  )
})

/**
 * Same for date + time (`<Input type="datetime-local">`): the hidden native input keeps "YYYY-MM-DDTHH:MM"; you type the
 * date as dd/mm/yyyy and pick the time beside it.
 */
export const DateTimeInput = React.forwardRef<HTMLInputElement, Props>(function DateTimeInput(
  { className, value, defaultValue, onChange, onBlur, disabled, id, style, ...rest },
  ref,
) {
  const native = React.useRef<HTMLInputElement | null>(null)
  const controlled = value !== undefined
  const split = (v: string) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v); return m ? { d: m[1], t: m[2] } : { d: '', t: '' } }
  const [parts, setParts] = React.useState(split(String(value ?? defaultValue ?? '')))
  const [text, setText] = React.useState(isoToDmy(parts.d))
  React.useEffect(() => { if (controlled) { const p = split(String(value ?? '')); setParts(p); setText(isoToDmy(p.d)) } }, [controlled, value])
  const setRefs = (el: HTMLInputElement | null) => {
    native.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el
  }
  const commit = (d: string, t: string) => {
    const el = native.current
    const v = d ? `${d}T${t || '00:00'}` : ''
    if (!el || el.value === v) return
    nativeValueSetter?.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const blur = (e: React.FocusEvent<HTMLInputElement>) => onBlur?.({ ...e, target: native.current ?? e.target } as React.FocusEvent<HTMLInputElement>)
  return (
    <div className={cn('relative items-center gap-1', /(^|\s)(max-)?w-/.test(className ?? '') ? 'inline-flex' : 'flex w-full', className)} style={style}>
      <input
        id={id} type="text" inputMode="numeric" autoComplete="off" dir="ltr" disabled={disabled} placeholder="dd/mm/yyyy" value={text}
        onChange={(e) => {
          const next = autoSlash(e.target.value)
          setText(next)
          const iso = next ? dmyToIso(next) : ''
          if (iso !== null) { setParts((p) => ({ ...p, d: iso })); commit(iso, parts.t) }
        }}
        onBlur={(e) => { if (text && !dmyToIso(text)) setText(isoToDmy(parts.d)); blur(e) }}
        className="h-full min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
      />
      <input
        type="time" dir="ltr" disabled={disabled} value={parts.t}
        onChange={(e) => { setParts((p) => ({ ...p, t: e.target.value })); if (parts.d) commit(parts.d, e.target.value) }}
        onBlur={blur}
        className="h-full w-28 rounded-md border border-input bg-background px-2 text-sm"
      />
      <input
        {...rest} ref={setRefs} type="datetime-local" tabIndex={-1} aria-hidden="true" disabled={disabled}
        {...(controlled ? { value: String(value ?? '') } : defaultValue !== undefined ? { defaultValue } : {})}
        onChange={(e) => { const p = split(e.target.value); setParts(p); setText(isoToDmy(p.d)); onChange?.(e) }}
        className="pointer-events-none absolute bottom-0 end-0 h-px w-px opacity-0"
      />
    </div>
  )
})
