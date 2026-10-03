'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Shown when adding a student to a full group (server answered GROUP_FULL):
 * put the student on this group's waiting list, or add anyway (needs the
 * "Group capacity" permission).
 */
export function FullGroupDialog({
  target,
  onClose,
  onDone,
}: {
  target: { groupId: string; studentId: string; message: string } | null
  onClose: () => void
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canOverride = !!perms?.permissions?.group_capacity?.includes('approve')
  const send = useMutation({
    mutationFn: (mode: 'waitlist' | 'override') =>
      fetchApi<{ waitlisted?: boolean; position?: number }>(`/api/groups/${target!.groupId}/students`, {
        method: 'POST',
        body: JSON.stringify({ studentId: target!.studentId, [mode]: true }),
      }),
    onSuccess: (r) => {
      notify.success(r?.waitlisted ? `On the waiting list (#${r.position ?? '?'})` : 'Student added (over the limit)')
      for (const k of ['group-detail', 'groups', 'waiting-list']) qc.invalidateQueries({ queryKey: [k] })
      onClose()
      onDone?.()
    },
    onError: (e: Error) => notify.error(e.message || 'Could not do it'),
  })
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This group is full</AlertDialogTitle>
          <AlertDialogDescription>{target?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-wrap gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {canOverride && (
            <Button variant="outline" disabled={send.isPending} onClick={() => send.mutate('override')}>Add anyway</Button>
          )}
          <Button disabled={send.isPending} onClick={() => send.mutate('waitlist')}>Put on this group&apos;s waiting list</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
