'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Copy, KeyRound, Loader2, MessageCircle } from 'lucide-react'

interface Guardian { id: string; firstName: string; lastName: string; phoneNumber: string; relationship?: string }

type Target = { target: 'guardian'; guardianId: string; label: string } | { target: 'student'; label: string }

interface Issued {
  target: 'guardian' | 'student'
  accountName: string
  loginId: string
  password: string
  loginUrl: string
  whatsappTo: string | null
  message: string
}

interface Props {
  studentId: string
  studentName: string
  guardians: Guardian[]
  hasStudentAccount: boolean
}

/**
 * "Portal access" card: one click issues a temporary password for a parent or
 * the student and shows a ready message to copy or send on WhatsApp.
 * Shown only to roles with account_management:update (Permissions page).
 */
export function StudentPortalAccessCard({ studentId, studentName, guardians, hasStudentAccount }: Props) {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ role: string; permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: status === 'authenticated' && !!role,
  })
  const [confirm, setConfirm] = useState<Target | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)

  const issue = useMutation({
    mutationFn: (t: Target) =>
      fetchApi<Issued>(`/api/students/${studentId}/portal-password`, {
        method: 'POST',
        body: JSON.stringify(t.target === 'guardian' ? { target: 'guardian', guardianId: t.guardianId } : { target: 'student' }),
      }),
    onSuccess: (r) => setIssued(r),
    onError: (err: Error) => notify.error(err.message || 'Could not create a temporary password'),
  })

  if (!perms?.permissions?.account_management?.includes('update')) return null

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify.success(`${what} copied`)
    } catch {
      notify.error('Copy failed. Select the text and copy it manually.')
    }
  }

  const targets: Target[] = [
    ...guardians.map((g) => ({
      target: 'guardian' as const,
      guardianId: g.id,
      label: `${g.firstName} ${g.lastName}`.trim() + (g.relationship ? ` (${g.relationship})` : '') + ` · ${g.phoneNumber}`,
    })),
    ...(hasStudentAccount ? [{ target: 'student' as const, label: `${studentName} (student)` }] : []),
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4" /> Portal access</CardTitle>
        <CardDescription>
          Create a temporary password and send it. It must be changed at first sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {targets.length === 0 && <p className="text-sm text-muted-foreground">No parent or student account yet.</p>}
        {targets.map((t) => (
          <div key={t.target === 'guardian' ? t.guardianId : 'student'} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2">
            <span className="min-w-0 break-words text-sm">{t.label}</span>
            <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => setConfirm(t)}>
              {issue.isPending && issue.variables === t ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Temporary password
            </Button>
          </div>
        ))}
      </CardContent>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a new temporary password?</AlertDialogTitle>
            <AlertDialogDescription>
              For {confirm?.label}. Their current password will stop working right away; send them the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) issue.mutate(confirm)
                setConfirm(null)
              }}
            >
              Create password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Temporary password for {issued?.accountName}</DialogTitle>
            <DialogDescription>
              Shown only once. If you close this before sending it, create a new one.
            </DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{issued.target === 'guardian' ? 'Login (phone)' : 'Login'}</div>
                  <div className="break-all font-mono text-sm">{issued.loginId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Password</div>
                  <div className="select-all font-mono text-lg font-semibold">{issued.password}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => copy(issued.password, 'Password')} aria-label="Copy password">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <textarea
                readOnly
                dir="rtl"
                value={issued.message}
                className="h-40 w-full resize-none rounded-md border bg-background p-2 text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copy(issued.message, 'Message')}>
                  <Copy className="mr-2 h-4 w-4" /> Copy message
                </Button>
                {issued.whatsappTo ? (
                  <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
                    <a href={`https://wa.me/${issued.whatsappTo}?text=${encodeURIComponent(issued.message)}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="mr-2 h-4 w-4" /> Send on WhatsApp
                    </a>
                  </Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">No valid phone number for WhatsApp; copy the message instead.</span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
