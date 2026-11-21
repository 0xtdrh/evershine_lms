import { L } from '@/lib/i18n/client'

/** A label map that answers in the screen language (read at render time): bi({ CALL: ['📞 Call', '📞 مكالمة'] }).CALL */
export function bi(m: Record<string, [string, string]>): Record<string, string> {
  return new Proxy({} as Record<string, string>, { get: (_t, k) => (typeof k === 'string' && m[k] ? L(m[k][0], m[k][1]) : undefined) })
}
