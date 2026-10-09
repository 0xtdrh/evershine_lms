/**
 * TechNova UI texts in English and Arabic (docs/plan-learning-platform.md §14.1).
 * New screens use t('key'); existing screens are translated as they are touched.
 * Keys are grouped by area. A missing Arabic text falls back to English.
 */

export const LOCALES = ['en', 'ar'] as const
export type Locale = (typeof LOCALES)[number]

const en = {
  // common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.loading': 'Loading…',
  'common.saved': 'Saved',
  'common.search': 'Search',
  'common.none': 'Nothing here yet.',
  'common.on': 'On',
  'common.off': 'Off',
  'common.language': 'Language',
  'common.error': 'Something went wrong. Please try again.',
  // agreements
  'agree.title': 'Before you continue',
  'agree.subtitle': 'Please read and accept the following to use the TechNova portal.',
  'agree.step': 'Step {n} of {total}',
  'agree.accept': 'I have read and I accept',
  'agree.acceptAll': 'Accept and continue',
  'agree.updated': 'Updated (version {v}) — please accept again.',
  'agree.mustScroll': 'Scroll to the end to accept.',
  'agree.done': 'Thank you!',
  // modules
  'module.off': 'This part of TechNova is switched off.',
  // curriculum
  'cur.title': 'Curriculum',
  'cur.subtitle': 'Lessons for every level, written once and used by every group of that level.',
  'cur.editions': 'Curriculum versions',
  'cur.newEdition': 'New version',
  'cur.sessions': 'Sessions',
  'cur.session': 'Session {n}',
  'cur.status.DRAFT': 'Draft',
  'cur.status.IN_REVIEW': 'In review',
  'cur.status.PUBLISHED': 'Published',
  'cur.status.ARCHIVED': 'Archived',
  'cur.audience.BOTH': 'Instructor + students',
  'cur.audience.INSTRUCTOR': 'Instructor only',
  'cur.audience.STUDENT': 'Students only',
  'cur.preview': 'Preview as a student',
  'cur.objectives': 'Objectives',
  'cur.materials': 'Materials / kits',
  'cur.instructorNotes': 'Instructor notes',
  'cur.duration': 'Duration (minutes)',
  'cur.skills': 'Skills',
  'cur.addBlock': 'Add content',
  'cur.submitReview': 'Send for review',
  'cur.publish': 'Publish',
  'cur.duplicate': 'Duplicate',
  'cur.coming': 'coming in a later stage',
} as const

export type MessageKey = keyof typeof en

const ar: Partial<Record<MessageKey, string>> = {
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.close': 'إغلاق',
  'common.edit': 'تعديل',
  'common.delete': 'حذف',
  'common.add': 'إضافة',
  'common.back': 'رجوع',
  'common.next': 'التالي',
  'common.loading': 'جاري التحميل…',
  'common.saved': 'تم الحفظ',
  'common.search': 'بحث',
  'common.none': 'لا يوجد شيء هنا بعد.',
  'common.on': 'تشغيل',
  'common.off': 'إيقاف',
  'common.language': 'اللغة',
  'common.error': 'حدثت مشكلة، حاول مرة أخرى.',
  'agree.title': 'قبل المتابعة',
  'agree.subtitle': 'من فضلك اقرأ ووافق على ما يلي لاستخدام بوابة TechNova.',
  'agree.step': 'خطوة {n} من {total}',
  'agree.accept': 'قرأت وأوافق',
  'agree.acceptAll': 'موافق ومتابعة',
  'agree.updated': 'تم التحديث (نسخة {v}) — من فضلك وافق مرة أخرى.',
  'agree.mustScroll': 'انزل لآخر النص للموافقة.',
  'agree.done': 'شكرًا لك!',
  'module.off': 'هذا الجزء من TechNova متوقف حاليًا.',
  'cur.title': 'المنهج',
  'cur.subtitle': 'دروس كل مستوى، تُكتب مرة واحدة وتستخدمها كل مجموعات المستوى.',
  'cur.editions': 'نسخ المنهج',
  'cur.newEdition': 'نسخة جديدة',
  'cur.sessions': 'الحصص',
  'cur.session': 'الحصة {n}',
  'cur.status.DRAFT': 'مسودة',
  'cur.status.IN_REVIEW': 'قيد المراجعة',
  'cur.status.PUBLISHED': 'منشورة',
  'cur.status.ARCHIVED': 'مؤرشفة',
  'cur.audience.BOTH': 'المدرب والطلبة',
  'cur.audience.INSTRUCTOR': 'المدرب فقط',
  'cur.audience.STUDENT': 'الطلبة فقط',
  'cur.preview': 'معاينة كطالب',
  'cur.objectives': 'الأهداف',
  'cur.materials': 'الأدوات المطلوبة',
  'cur.instructorNotes': 'ملاحظات المدرب',
  'cur.duration': 'المدة (دقيقة)',
  'cur.skills': 'المهارات',
  'cur.addBlock': 'إضافة محتوى',
  'cur.submitReview': 'إرسال للمراجعة',
  'cur.publish': 'نشر',
  'cur.duplicate': 'نسخ',
  'cur.coming': 'يتم إضافته في مرحلة لاحقة',
}

export const MESSAGES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ar }

/** Pure translate (also usable on the server). */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = MESSAGES[locale]?.[key] ?? en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Pick the right language from a bilingual pair (content fields like titleEn / titleAr). */
export const pick = (locale: Locale, enText?: string | null, arText?: string | null) =>
  (locale === 'ar' ? arText || enText : enText || arText) ?? ''
