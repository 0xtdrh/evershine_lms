'use client'

/**
 * /change-password — shown when the account has a temporary password issued by
 * staff (User.mustChangePassword). Middleware sends every /dashboard request
 * here until the password is changed. After changing, the user signs in again
 * so the session no longer carries the flag.
 */

import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Loader2 } from 'lucide-react'

export default function ChangePasswordPage() {
  const { status } = useSession({ required: true })
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (form.newPassword !== form.confirmPassword) return setError('The two new passwords do not match.')
    if (form.newPassword.length < 8 || !/[a-z]/.test(form.newPassword) || !/[A-Z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) {
      return setError('Use at least 8 characters with a capital letter, a small letter and a number.')
    }
    setSaving(true)
    try {
      await fetchApi('/api/users/change-password', { method: 'POST', body: JSON.stringify(form) })
      await signOut({ callbackUrl: '/login?changed=1' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password')
      setSaving(false)
    }
  }

  if (status === 'loading') return null

  return (
    <AuthLayout pageType="change-password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Temporary password (the one you just used)</Label>
          <Input id="currentPassword" type="password" autoComplete="current-password" value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input id="newPassword" type="password" autoComplete="new-password" value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          <p className="text-xs text-slate-500">At least 8 characters, with a capital letter, a small letter and a number. Not your phone number.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save and sign in again
        </Button>
      </form>
    </AuthLayout>
  )
}
