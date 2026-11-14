import { AuthI18n } from '@/components/auth/AuthI18n'

/** Final test 14/11: Arabic by default + language button (components/auth/AuthI18n.tsx). */
export default function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  return <AuthI18n>{children}</AuthI18n>
}
