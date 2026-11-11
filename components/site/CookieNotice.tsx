'use client'

/** x01: the cookie notice. Accept = we may remember the device (repeat visits) and keep the IP for 90 days. */

import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import { getConsent, setConsent } from './tracker'

export function CookieNotice() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(getConsent() === null) }, [])
  if (!show) return null
  const answer = (v: 'yes' | 'no') => { setConsent(v); setShow(false) }
  return (
    <div className="tns-cookie" role="region" aria-label={ar ? 'الكوكيز' : 'Cookies'}>
      <p>
        {ar
          ? 'نستخدم ملفات تعريف الارتباط (الكوكيز) لتحليل الزيارات وتحسين تجربتك على الموقع، ولا نشارك بياناتك مع أي طرف آخر.'
          : 'We use cookies to analyse website traffic and improve your experience. We never share your data with third parties.'}{' '}
        <a href="/policies">{ar ? 'سياسة الخصوصية' : 'Privacy policy'}</a>
      </p>
      <div className="row">
        <button type="button" className="tns-btn ghost sm" onClick={() => answer('no')}>{ar ? 'الضرورية فقط' : 'Necessary only'}</button>
        <button type="button" className="tns-btn brand sm" onClick={() => answer('yes')}>{ar ? 'قبول' : 'Accept'}</button>
      </div>
    </div>
  )
}
