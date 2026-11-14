'use client'

/**
 * Final test 14/11: the sign-in, sign-up, password and account-setup pages already had Arabic text (L()), but no
 * language provider wrapped them, so they always showed English. Arabic is the default here; the language button
 * in the header switches (owner: a language button on every page).
 */

import { I18nProvider } from '@/lib/i18n/client'

export function AuthI18n({ children }: { children: React.ReactNode }) {
  return <I18nProvider defaults={{ staff: 'ar', portal: 'ar' }}>{children}</I18nProvider>
}
