/**
 * 2026-10-20 Arabic names of the built-in payment methods for screens (the stored name stays as it is, e.g. "Cash").
 * Methods the owner adds with an Arabic name are shown as they are.
 */
const AR: Record<string, string> = {
  'Cash': 'كاش', 'Bank Transfer': 'تحويل بنكي', 'InstaPay': 'إنستاباي', 'Vodafone Cash': 'فودافون كاش',
  'Fawry': 'فوري', 'Cheque': 'شيك', 'Card': 'كارت', 'Wallet': 'المحفظة', 'Online': 'أونلاين',
}

export function methodLabel(name: string, locale: string): string {
  return locale === 'ar' ? AR[name] ?? name : name
}
