/**
 * x01: the website content saved from the "Website" screen, merged over the defaults in code (pure, tested).
 * Objects merge key by key (a key added to the code later gets its default); lists come from what was saved (so items can
 * be added, removed or reordered); a value of the wrong type falls back to the default. Unknown keys are dropped.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function mergeContent<T>(def: T, saved: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(saved) ? clean(saved, 0) : def) as T
  if (isObj(def)) {
    if (!isObj(saved)) return def
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(def)) out[k] = k in saved ? mergeContent((def as Record<string, unknown>)[k], saved[k]) : (def as Record<string, unknown>)[k]
    // optional switches / extras that the default leaves out (show, sample, href, value…)
    for (const k of ['show', 'sample', 'href', 'value', 'min', 'plus', 'source', 'icon', 'cta', 'tag'] as const) {
      if (!(k in out) && k in saved) out[k] = clean(saved[k], 1)
    }
    return out as T
  }
  if (typeof def === 'string') return (typeof saved === 'string' ? saved.slice(0, 4000) : def) as T
  if (typeof def === 'number') return (typeof saved === 'number' && Number.isFinite(saved) ? saved : def) as T
  if (typeof def === 'boolean') return (typeof saved === 'boolean' ? saved : def) as T
  return (saved === undefined ? def : clean(saved, 0)) as T
}

/** Plain JSON only: text cut at 4000 characters, at most 200 items per list, at most 8 levels deep. */
export function clean(v: unknown, depth: number): unknown {
  if (depth > 8) return null
  if (typeof v === 'string') return v.slice(0, 4000)
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean' || v === null) return v
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => clean(x, depth + 1))
  if (isObj(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v).slice(0, 80)) if (/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) out[k] = clean(x, depth + 1)
    return out
  }
  return null
}
