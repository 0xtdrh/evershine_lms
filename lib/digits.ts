/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → 0-9. Pure and client-safe (final test X05). */
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}
