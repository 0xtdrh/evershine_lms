'use client'

import { ShieldX, ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { L, useI18n } from '@/lib/i18n/client'

interface AccessDeniedProps {
  title?: string
  message?: string
}

const ARABIC = /[؀-ۿ]/

/**
 * Full-page access restriction banner.
 * Rendered when the authenticated user's role is not permitted to view a page.
 * WHY: Keeps the user inside the dashboard shell rather than redirecting,
 * giving a cleaner UX and a clear explanation of the restriction.
 *
 * Final test 14/11 (owner): ONE Arabic refusal page. 64 screens pass their own (often English-only) text; on an
 * Arabic screen an English-only title / message is replaced by the standard Arabic one. Plus a "go back" button.
 */
export function AccessDenied({ title, message }: AccessDeniedProps) {
  const { locale } = useI18n()
  const router = useRouter()
  const ar = locale === 'ar'
  const t = title && (!ar || ARABIC.test(title)) ? title : L('Access restricted', 'الصفحة دي مش ضمن صلاحياتك')
  const m = message && (!ar || ARABIC.test(message))
    ? message
    : L('You do not have permission to open this page. Ask your manager if you need it.', 'مش مسموحلك تفتح الصفحة دي. لو محتاجها كلّم المدير يديك الصلاحية.')
  return (
    <div className="flex flex-col items-center justify-center min-h-[65vh] max-w-md mx-auto text-center p-8 space-y-5">
      <div className="p-5 bg-rose-50 rounded-2xl border border-rose-200 text-rose-500">
        <ShieldX className="w-14 h-14" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">{t}</h2>
        <p className="text-slate-500 text-sm leading-relaxed">{m}</p>
      </div>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? router.back() : router.push('/dashboard'))}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" aria-hidden />
        {L('Go back', 'ارجع')}
      </button>
    </div>
  )
}
