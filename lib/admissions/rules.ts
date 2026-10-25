/**
 * Rules shown on the public online application (2026-10-24, owner: "I must be able to edit them").
 * Kept in AppSetting `admission.rules`; edited on the Agreements page. The defaults replaced the template rules
 * ("fee is neither refundable nor adjustable in any case"…) that contradicted TechNova's refund rules.
 * Pure data — safe for client and server.
 */

export interface AdmissionRule { en: string; ar: string }
export interface AdmissionRules { items: AdmissionRule[] }

export const ADMISSION_RULES_KEY = 'admission.rules'
export const MAX_ADMISSION_RULES = 30

export const DEFAULT_ADMISSION_RULES: AdmissionRules = {
  items: [
    { en: 'Fees are paid per the group payment rules (shown before the first session). Refunds follow the published refund policy.',
      ar: 'الرسوم بتتدفع حسب نظام الدفع بتاع الجروب (بيظهر قبل أول حصة). والاسترداد حسب سياسة الاسترداد المنشورة.' },
    { en: 'Please pay each invoice by the due date written on it.', ar: 'ادفع كل فاتورة قبل الميعاد المكتوب عليها.' },
    { en: 'Session times may change (instructor availability or holidays); you are told in advance and a makeup session is arranged when needed.',
      ar: 'مواعيد الحصص ممكن تتغير (ظروف المدرب أو الإجازات)، وهنبلغك قبلها ونعمل حصة تعويضية لو محتاج.' },
    { en: 'The group rules (times, fees, absence and excuses) are shown in the parent account and must be accepted before the first session.',
      ar: 'قواعد الجروب (المواعيد، الرسوم، الغياب والأعذار) بتظهر في حساب ولي الأمر ولازم توافق عليها قبل أول حصة.' },
    { en: 'Parents are welcome to contact the branch at any time to follow the progress of the student.', ar: 'أهلاً بيك تكلّم الفرع في أي وقت تتابع مستوى الطالب.' },
    { en: 'Damage caused on purpose to TechNova equipment is charged at its cost.', ar: 'أي تلف متعمد في أجهزة TechNova بيتحاسب بتمنه.' },
    { en: 'To stop, please tell the branch before the group of the next month starts.', ar: 'لو هتوقف، بلّغ الفرع قبل ما جروب الشهر الجاي يبدأ.' },
  ],
}

/** Drop empty lines, trim, cap the count and length. */
export function cleanAdmissionRules(items: AdmissionRule[]): AdmissionRules {
  return {
    items: items
      .map((r) => ({ en: (r.en ?? '').trim().slice(0, 600), ar: (r.ar ?? '').trim().slice(0, 600) }))
      .filter((r) => r.en || r.ar)
      .slice(0, MAX_ADMISSION_RULES),
  }
}
