/**
 * 2026-10-19: how a place is named in pickers — a partner's place shows its partner ("Hilton Kids Club — Hilton"), so
 * nobody mixes up two places with similar names. /api/campuses sends `label`; older lists fall back to the name.
 */
export function campusLabel(c: { name?: string | null; label?: string | null }): string {
  return c.label || c.name || ''
}
