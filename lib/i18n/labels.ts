/**
 * Stored English labels shown in the screen language (final test 18/11). Pure; the screens call them with L().
 * Invoice titles are stored as "<Course> — <Level> — Month 2"; invoice statuses are enum codes (ISSUED…).
 */

export const INVOICE_STATUS: Record<string, { en: string; ar: string }> = {
  DRAFT: { en: 'Draft', ar: 'مسودة' },
  ISSUED: { en: 'Not paid yet', ar: 'لسه مادفعتش' },
  UNPAID: { en: 'Not paid yet', ar: 'لسه مادفعتش' },
  PARTIALLY_PAID: { en: 'Partly paid', ar: 'مدفوعة جزئيًا' },
  PARTIAL: { en: 'Partly paid', ar: 'مدفوعة جزئيًا' },
  PAID: { en: 'Paid', ar: 'مدفوعة' },
  OVERDUE: { en: 'Overdue', ar: 'متأخرة' },
  CANCELLED: { en: 'Cancelled', ar: 'ملغية' },
  PENDING: { en: 'Waiting', ar: 'مستنية' },
}

export function invoiceStatusText(status: string | null | undefined, lang: 'en' | 'ar'): string {
  if (!status) return ''
  return INVOICE_STATUS[status]?.[lang] ?? status.toLowerCase().replace(/_/g, ' ')
}

/** "NovaBuilders — Level 2 — Month 1" → "NovaBuilders — المستوى 2 — الشهر 1" in Arabic (names of courses stay as they are). */
export function cycleLabel(text: string | null | undefined, lang: 'en' | 'ar'): string {
  const t = text ?? ''
  if (lang === 'en') return t
  return t.replace(/\bMonth\s+(\d+)\b/gi, 'الشهر $1').replace(/\bLevel\s+(\d+)\b/g, 'المستوى $1')
}
