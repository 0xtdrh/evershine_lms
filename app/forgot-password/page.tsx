'use client'

import Link from 'next/link'
import { useState } from 'react'
import { notify } from '@/lib/notify'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, AlertCircle, Send, CheckCircle } from 'lucide-react'

import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { L, useI18n } from '@/lib/i18n/client'
import { toLatinDigits } from '@/lib/digits'

const forgotSchema = z.object({
  email: z.string().email(), // message in the screen language below
})
type ForgotForm = z.infer<typeof forgotSchema>

export default function ForgotPasswordPage() {
  useI18n() // final test 14/11: Arabic + language switch
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSent, setIsSent]             = useState(false)
  const [serverError, setServerError]   = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors }, watch } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
  })

  const emailValue = watch('email')
  // final test X06: a parent signs in with the phone and has no real email — tell them what to do instead of "invalid email"
  const typedPhone = !!emailValue && !emailValue.includes('@') && /^[+\d][\d\s\-()]{6,}$/.test(toLatinDigits(emailValue).trim())

  const onSubmit = async (data: ForgotForm) => {
    if (typedPhone) return
    setIsSubmitting(true)
    setServerError(null)
    try {
      await fetchApi('/api/auth/forgot-password', {
        method: 'POST',
        body:   JSON.stringify(data),
      })
      setIsSent(true)
      notify.success(L('Reset email sent', 'اتبعت إيميل تغيير الباسورد'), {
        description: L('If your email is registered, you will receive instructions shortly.', 'لو الإيميل متسجّل عندنا هيوصلك لينك خلال دقايق.'),
      })
    } catch (error) {
      const message = (error as Error).message || L('Unable to submit request', 'الطلب ماتبعتش')
      setServerError(message)
      notify.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout pageType="forgot-password">
      {/* ── Server error ── */}
      <AnimatePresence>
        {serverError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
            role="alert"
          >
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 flex items-start gap-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-semibold">{L('Something went wrong', 'حصلت مشكلة')}</p>
                <p className="text-xs mt-0.5 opacity-80">{serverError}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isSent ? (
          /* ── SUCCESS STATE ── */
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
            className="space-y-5"
            role="status"
            aria-live="polite"
          >
            {/* Success card */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100">
                <CheckCircle className="w-7 h-7 text-emerald-600" aria-hidden />
              </div>
              <div>
                <p className="font-bold text-emerald-900 text-lg">{L('Check your email', 'شوف الإيميل بتاعك')}</p>
                <p className="text-sm text-emerald-700 mt-1.5 leading-relaxed">
                  {L('We sent password reset instructions to:', 'بعتنا لينك تغيير الباسورد على:')}
                </p>
                <p className="font-semibold text-slate-900 mt-2 break-all text-sm">{emailValue}</p>
              </div>
            </div>

            {/* Next steps */}
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{L('Next steps:', 'الخطوات:')}</p>
              <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                <li>{L('Check your inbox for an email from us', 'افتح الإيميل اللي جالك مننا')}</li>
                <li>{L('Click the "Reset Password" link in the email', 'دوس على لينك «تغيير الباسورد»')}</li>
                <li>{L('Create a new strong password', 'اكتب باسورد جديد قوي')}</li>
                <li>{L('Sign in with your new password', 'ادخل بالباسورد الجديد')}</li>
              </ol>
            </div>

            <p className="text-xs text-slate-400 text-center">
              {L('Tip: check your spam folder if you do not see the email', 'لو مالقيتش الإيميل شوف فولدر الـ Spam')}
            </p>
          </motion.div>
        ) : (
          /* ── FORM STATE ── */
          <motion.form
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-semibold text-slate-700">{L('Email address', 'الإيميل')}</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-required="true"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : 'email-hint'}
                  {...register('email')}
                  className={`pl-10 ${errors.email ? 'border-red-400 ring-1 ring-red-400/30' : ''}`}
                />
              </div>
              {typedPhone && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800" role="status">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  {L('Parents sign in with the phone number and have no email here. Call your branch: they give you a temporary password.', 'ولي الأمر بيدخل برقم الموبايل ومالوش إيميل هنا. كلّم الفرع وهيدّوك باسورد مؤقت.')}
                </p>
              )}
              <AnimatePresence>
                {errors.email && !typedPhone ? (
                  <motion.p
                    id="email-error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="text-xs text-red-600 flex items-center gap-1.5"
                    role="alert"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                    {L('Please enter a valid email address', 'اكتب إيميل صحيح')}
                  </motion.p>
                ) : (
                  <p id="email-hint" className="text-xs text-slate-400 leading-relaxed">
                    {L('We will send you a link to reset your password. It expires in 1 hour.', 'هنبعتلك لينك تغيّر بيه الباسورد. اللينك بيخلص بعد ساعة.')}
                  </p>
                )}
              </AnimatePresence>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="w-full h-11 rounded-2xl text-sm font-semibold"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {L('Sending reset link…', 'بنبعت اللينك…')}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Send className="w-4 h-4" aria-hidden />
                  {L('Send reset link', 'ابعت اللينك')}
                </span>
              )}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}
