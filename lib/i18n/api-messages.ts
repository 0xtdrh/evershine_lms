/**
 * Final test 14/11: server error messages shown in the screen language.
 *
 * 1. Many routes answer "English sentence · جملة عربي" — keep only the side of the screen language.
 * 2. The most common English-only messages (permission, not found, rate limit…) get an Arabic version.
 * Pure (no React): used by lib/api-client.ts when it builds an ApiError, so every screen gets it at once.
 */

export type Lang = 'en' | 'ar'

const ARABIC = /[؀-ۿ]/

/** Exact English messages → Arabic (server defaults + the ones the final test met). */
const KNOWN: Record<string, string> = {
  'You do not have permission to perform this action': 'العملية دي مش ضمن صلاحياتك. كلّم المدير لو محتاجها.',
  'Authentication required': 'لازم تسجّل دخول الأول.',
  'Resource already exists': 'ده موجود قبل كده.',
  'Too many requests. Please try again later.': 'محاولات كتير ورا بعض. استنى شوية وجرّب تاني.',
  'An unexpected error occurred. Please try again.': 'حصلت مشكلة. جرّب تاني بعد شوية.',
  'You are not assigned to this section': 'الجروب ده مش من جروباتك.',
  'Not your group': 'الدرس ده مش من جروبك.',
  'This lesson is not open yet': 'الدرس ده لسه ما اتفتحش.',
  'Academic year is locked': 'الفترة دي مقفولة، مينفعش تعديل فيها.',
  'Invalid JSON': 'البيانات اللي اتبعتت مش مظبوطة.',
  'Payment proof too large. Maximum allowed size is 4 MB.': 'الملف كبير. أقصى حجم 4 ميجا.',
  'Invalid payment proof format. Only JPG, PNG, and PDF are accepted.': 'نوع الملف مش مقبول. ابعت صورة JPG أو PNG أو ملف PDF بس.',
  'The proof must be uploaded through the system': 'ارفع الإيصال من هنا (مش لينك من مكان تاني).',
  'Cannot upload proof for a paid invoice': 'الفاتورة دي مدفوعة خلاص.',
  'Validation failed': 'البيانات فيها حاجة ناقصة أو غلط.',
}

/** "<Entity> not found" → Arabic. */
function notFound(msg: string): string | null {
  const m = msg.match(/^(.{1,60}) not found$/)
  return m ? 'مش لاقيين المطلوب (ممكن يكون اتمسح أو مش من صلاحياتك).' : null
}

/** "English · عربي" (either order) → the side in `lang`. Null when the text is not such a pair. */
function pickSide(msg: string, lang: Lang): string | null {
  const parts = msg.split(' · ')
  if (parts.length < 2) return null
  const ar = parts.filter((p) => ARABIC.test(p))
  const en = parts.filter((p) => !ARABIC.test(p))
  // a real pair: both languages present and the English side is a sentence, not a label like "Explorer 1 A"
  if (!ar.length || !en.length || !en.some((p) => p.trim().split(/\s+/).length >= 4)) return null
  return (lang === 'ar' ? ar : en).join(' · ').trim()
}

export function localizeMessage(msg: string | null | undefined, lang: Lang): string {
  const text = String(msg ?? '').trim()
  if (!text) return text
  const side = pickSide(text, lang)
  if (side) return side
  if (lang !== 'ar' || ARABIC.test(text)) return text
  return KNOWN[text] ?? notFound(text) ?? text
}

/** Language of the page in the browser (cookie set by the language switch); Arabic when no choice yet in an RTL page. */
export function browserLang(): Lang {
  if (typeof document === 'undefined') return 'en'
  const m = document.cookie.match(/(?:^|; )tn-lang=(en|ar)/)
  if (m) return m[1] as Lang
  return document.documentElement.dir === 'rtl' || document.documentElement.lang === 'ar' ? 'ar' : 'en'
}
