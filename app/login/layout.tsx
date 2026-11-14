import { AuthI18n } from '@/components/auth/AuthI18n'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portal Login',
  robots: {
    index: false,
    follow: false,
  },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <AuthI18n>{children}</AuthI18n>
}
