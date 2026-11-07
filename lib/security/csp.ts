/**
 * Security part 3 (2026-11-07): browser protection headers.
 * CSP starts in WATCH mode (Content-Security-Policy-Report-Only): nothing is blocked, the browser only reports what
 * WOULD be blocked to /api/security/csp-report (list on Settings → Sign-in security). Once the list stays clean,
 * set CSP_ENFORCE=1 on the host and rebuild: the same policy then blocks.
 * Pure (no imports): next.config.ts loads this file.
 */

/** Outside sites the screens really use (found in the code 2026-11-07). Frames, pictures and media allow any https site on purpose: admins add tool sites and video links. */
export function cspPolicy(dev = false): string {
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:', 'https://cdn.jsdelivr.net', 'https://unpkg.com', ...(dev ? ["'unsafe-eval'"] : [])],
    'worker-src': ["'self'", 'blob:', 'https://cdn.jsdelivr.net'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'data:', 'https:'],
    'connect-src': ["'self'", 'https://api.cloudinary.com', 'https://res.cloudinary.com', 'https://cdn.jsdelivr.net', ...(dev ? ['ws:', 'wss:'] : [])],
    'frame-src': ["'self'", 'https:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
    // report-uri only: with report-to Chrome holds reports back in a queue; report-uri sends each one at once (all browsers)
    'report-uri': ['/api/security/csp-report'],
  }
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ')
}

export const cspEnforced = (env: Record<string, string | undefined> = process.env) => env.CSP_ENFORCE === '1'

/** Headers for every page (not the JSON APIs; /api/h5p keeps its own frame rule). */
export function browserProtectionHeaders(env: Record<string, string | undefined> = process.env) {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: cspEnforced(env) ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', value: cspPolicy(env.NODE_ENV === 'development') },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  ]
}

export interface CspRow { directive: string; blocked: string; page: string }

/** Keep only the place, never the full link (no query strings or tokens in the log). */
function placeOf(u: unknown, kind: 'blocked' | 'page'): string {
  const s = String(u ?? '').trim()
  if (!s) return ''
  if (/^(inline|eval|wasm-eval|data|blob|self|trusted-types-[a-z]+)$/i.test(s)) return s.toLowerCase()
  if (/^(data|blob):/i.test(s)) return s.slice(0, s.indexOf(':')).toLowerCase()
  try {
    const x = new URL(s)
    return (kind === 'page' ? x.pathname.replace(/\/[0-9a-z]{20,}(?=\/|$)/gi, '/[id]') : x.protocol === 'https:' || x.protocol === 'http:' ? x.origin : x.protocol).slice(0, 190)
  } catch { return s.split(/[?#]/)[0].slice(0, 190) }
}

/** Reads both report formats (old `csp-report`, new Reporting API list). At most 20 rows from one request. */
export function readCspReports(body: unknown): CspRow[] {
  const raw: Record<string, unknown>[] = []
  if (Array.isArray(body)) {
    for (const r of body) if (r && typeof r === 'object' && (r as { type?: string }).type === 'csp-violation') raw.push(((r as { body?: object }).body ?? {}) as Record<string, unknown>)
  } else if (body && typeof body === 'object' && (body as { 'csp-report'?: object })['csp-report']) {
    raw.push((body as { 'csp-report': Record<string, unknown> })['csp-report'])
  }
  return raw.slice(0, 20).map((r) => ({
    directive: String(r.effectiveDirective ?? r['effective-directive'] ?? r['violated-directive'] ?? '').split(' ')[0].slice(0, 60),
    blocked: placeOf(r.blockedURL ?? r['blocked-uri'], 'blocked'),
    page: placeOf(r.documentURL ?? r['document-uri'], 'page'),
  })).filter((r) => r.directive)
}
