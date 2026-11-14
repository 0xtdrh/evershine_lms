import { AuthI18n } from '@/components/auth/AuthI18n'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reset Password',
  robots: {
    index: false,
    follow: false,
  },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <AuthI18n>{children}</AuthI18n>
}
