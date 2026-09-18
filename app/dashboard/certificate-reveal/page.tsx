'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { notify } from '@/lib/notify'
import { Loader2, Eye, EyeOff, Sparkles, PartyPopper, CheckSquare, Square, Download, History } from 'lucide-react'
import { buildCertificatesPdf, safeFilename, type PrintCertificate } from '@/lib/certificates/pdf-renderer'

interface PrintBatchDetail {
  batch: { id: string; label: string; mode: string; totalCount: number; printedBy: string; printedByName: string | null; createdAt: string }
  certificates: PrintCertificate[]
}

interface CertificateRow {
  id: string
  title: string
  certificateNumber: string
  isRevealed: boolean
  student: { id: string; firstName: string; lastName: string; fullNameAr?: string; profilePicture: string | null }
  subject: { id: string; name: string } | null
}

type StatusFilter = 'pending' | 'revealed' | 'all'

export default function CertificateRevealPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmAll, setConfirmAll] = useState(false)

  const { data: certificates = [], isLoading } = useQuery<CertificateRow[]>({
    queryKey: ['certificates-reveal-list', statusFilter],
    queryFn: () => fetchApi(`/api/certificates/reveal?status=${statusFilter}`),
  })

  const revealMutation = useMutation({
    mutationFn: (payload: { scope: 'certificate' | 'certificates' | 'student' | 'subject' | 'all'; isRevealed: boolean; certificateId?: string; certificateIds?: string[]; studentId?: string; subjectId?: string }) =>
      fetchApi('/api/certificates/reveal', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (res: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ['certificates-reveal-list'] })
      setSelectedIds(new Set())
      setConfirmAll(false)
      notify.success(`${res.revealedCount} certificate${res.revealedCount === 1 ? '' : 's'} ${vars.isRevealed ? 'revealed' : 'hidden'}`)
    },
    onError: () => notify.error('Failed to update certificates'),
  })

  const [isPrinting, setIsPrinting] = useState(false)

  const { data: printHistory = [] } = useQuery<{ id: string; label: string; mode: string; totalCount: number; createdAt: string }[]>({
    queryKey: ['certificate-print-history'],
    queryFn: () => fetchApi('/api/certificates/print'),
  })

  // ── Print batch detail (view/edit/delete an existing history entry) ──────
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [addQuery, setAddQuery] = useState('')
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false)
  const [isRedownloading, setIsRedownloading] = useState(false)

  const closeBatchDialog = () => {
    setSelectedBatchId(null)
    setAddQuery('')
    setConfirmDeleteBatch(false)
  }

  const { data: batchDetail, isLoading: isBatchLoading } = useQuery<PrintBatchDetail>({
    queryKey: ['certificate-print-batch', selectedBatchId],
    queryFn: () => fetchApi(`/api/certificates/print/${selectedBatchId}`),
    enabled: !!selectedBatchId,
  })

  // Reuses the same listing endpoint the main reveal list uses — searching
  // for a certificate to add to a batch doesn't need a dedicated endpoint.
  const { data: allCertificatesForAdd = [] } = useQuery<CertificateRow[]>({
    queryKey: ['certificates-all-for-print-add'],
    queryFn: () => fetchApi('/api/certificates/reveal?status=all'),
    enabled: !!selectedBatchId,
  })

  const currentBatchCertIds = useMemo(
    () => new Set((batchDetail?.certificates ?? []).map((c) => c.id)),
    [batchDetail]
  )

  const addSearchResults = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    if (q.length < 2) return []
    return allCertificatesForAdd
      .filter((c) => !currentBatchCertIds.has(c.id))
      .filter((c) =>
        `${c.student.firstName} ${c.student.lastName}`.toLowerCase().includes(q) ||
        c.certificateNumber.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [addQuery, allCertificatesForAdd, currentBatchCertIds])

  const updateBatchMutation = useMutation({
    mutationFn: (certificateIds: string[]) =>
      fetchApi(`/api/certificates/print/${selectedBatchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ certificateIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate-print-batch', selectedBatchId] })
      queryClient.invalidateQueries({ queryKey: ['certificate-print-history'] })
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        notify.error(err.fieldErrors.map((fe) => fe.message).join(' · '))
      } else {
        notify.error(err instanceof Error ? err.message : 'Failed to update this print batch')
      }
    },
  })

  const deleteBatchMutation = useMutation({
    mutationFn: () => fetchApi(`/api/certificates/print/${selectedBatchId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate-print-history'] })
      notify.success('Print batch deleted')
      closeBatchDialog()
    },
    onError: () => notify.error('Failed to delete this print batch'),
  })

  const handleRemoveFromBatch = (certId: string) => {
    if (!batchDetail) return
    const nextIds = batchDetail.certificates.filter((c) => c.id !== certId).map((c) => c.id)
    if (nextIds.length === 0) {
      notify.error('A print batch must contain at least one certificate — delete the batch instead')
      return
    }
    updateBatchMutation.mutate(nextIds)
  }

  const handleAddToBatch = (certId: string) => {
    if (!batchDetail) return
    const nextIds = [...batchDetail.certificates.map((c) => c.id), certId]
    updateBatchMutation.mutate(nextIds)
    setAddQuery('')
  }

  const handleRedownloadBatch = async () => {
    if (!batchDetail) return
    setIsRedownloading(true)
    try {
      const pdf = await buildCertificatesPdf(batchDetail.certificates)
      if (!pdf) {
        notify.error('None of these certificates have a design template to render')
        return
      }
      pdf.save(`${safeFilename(batchDetail.batch.label)}.pdf`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setIsRedownloading(false)
    }
  }

  const handleDownload = async () => {
    if (selectedIds.size === 0) return
    const label = window.prompt(
      'Name this print batch (saved in history so you can see what was printed and when):',
      `Ceremony ${new Date().getFullYear()}`
    )
    if (!label) return

    setIsPrinting(true)
    try {
      const res = await fetchApi<{ batchId: string; certificates: PrintCertificate[] }>(
        '/api/certificates/print',
        { method: 'POST', body: JSON.stringify({ certificateIds: Array.from(selectedIds), mode: 'COMBINED', label }) }
      )

      if (res.certificates.every((c) => !c.template)) {
        notify.error('None of the selected certificates have a design template. Upload one in Certificate Designer first.')
        return
      }

      const pdf = await buildCertificatesPdf(res.certificates)
      if (!pdf) { notify.error('Nothing to render'); return }
      pdf.save(`${safeFilename(label)}.pdf`)

      queryClient.invalidateQueries({ queryKey: ['certificate-print-history'] })
      notify.success(`${res.certificates.length} certificate${res.certificates.length === 1 ? '' : 's'} exported`)
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        notify.error(err.fieldErrors.map((fe) => fe.message).join(' · '))
      } else {
        notify.error(err instanceof Error ? err.message : 'Failed to generate PDF')
      }
    } finally {
      setIsPrinting(false)
    }
  }

  const bySubject = useMemo(() => {
    const groups = new Map<string, { subjectId: string | null; subjectName: string; items: CertificateRow[] }>()
    for (const c of certificates) {
      const key = c.subject?.id ?? 'none'
      if (!groups.has(key)) groups.set(key, { subjectId: c.subject?.id ?? null, subjectName: c.subject?.name ?? 'Uncategorized', items: [] })
      groups.get(key)!.items.push(c)
    }
    return Array.from(groups.values())
  }, [certificates])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedCerts = certificates.filter((c) => selectedIds.has(c.id))
  const allSelectedAreRevealed = selectedCerts.length > 0 && selectedCerts.every((c) => c.isRevealed)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-amber-500" /> Certificate Reveal
          </h1>
          <p className="text-sm text-slate-500 mt-1">Certificates are hidden from students & parents until you reveal them — typically at the annual ceremony.</p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setSelectedIds(new Set()) }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending only</SelectItem>
            <SelectItem value="revealed">Revealed only</SelectItem>
            <SelectItem value="all">All certificates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 bg-indigo-600 text-white rounded-xl px-4 py-2.5 flex items-center justify-between shadow-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            {!allSelectedAreRevealed && (
              <Button size="sm" variant="secondary" className="gap-1.5" disabled={revealMutation.isPending}
                onClick={() => revealMutation.mutate({ scope: 'certificates', certificateIds: Array.from(selectedIds), isRevealed: true })}>
                <Eye className="w-3.5 h-3.5" /> Reveal Selected
              </Button>
            )}
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={revealMutation.isPending}
              onClick={() => revealMutation.mutate({ scope: 'certificates', certificateIds: Array.from(selectedIds), isRevealed: false })}>
              <EyeOff className="w-3.5 h-3.5" /> Hide Selected
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={isPrinting}
              onClick={handleDownload}>
              {isPrinting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download as PDF
            </Button>
            <Button size="sm" variant="ghost" className="text-white hover:text-white hover:bg-indigo-500" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {statusFilter !== 'revealed' && certificates.some((c) => !c.isRevealed) && (
        confirmAll ? (
          <div className="flex items-center gap-2 justify-end">
            <span className="text-sm text-amber-700 font-medium">Reveal every pending certificate?</span>
            <Button size="sm" variant="destructive" onClick={() => revealMutation.mutate({ scope: 'all', isRevealed: true })} disabled={revealMutation.isPending}>
              {revealMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button className="gap-2 bg-amber-500 hover:bg-amber-600" onClick={() => setConfirmAll(true)}>
              <PartyPopper className="w-4 h-4" /> Reveal All Pending
            </Button>
          </div>
        )
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : certificates.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-slate-400">No certificates match this filter.</CardContent></Card>
      ) : (
        bySubject.map((group) => (
          <Card key={group.subjectId ?? 'none'}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">{group.subjectName}</CardTitle>
                <CardDescription>{group.items.length} certificate{group.items.length === 1 ? '' : 's'}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedIds((prev) => {
                  const next = new Set(prev)
                  const allSelected = group.items.every((i) => next.has(i.id))
                  group.items.forEach((i) => allSelected ? next.delete(i.id) : next.add(i.id))
                  return next
                })}
              >
                {group.items.every((i) => selectedIds.has(i.id)) ? 'Deselect group' : 'Select group'}
              </Button>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100">
              {group.items.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5">
                  <button type="button" onClick={() => toggleSelect(c.id)} className="flex items-center gap-2 flex-1 text-left">
                    {selectedIds.has(c.id) ? <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" /> : <Square className="w-4 h-4 text-slate-300 shrink-0" />}
                    <Badge variant="outline" className="text-[10px] text-slate-400 font-mono">{c.certificateNumber}</Badge>
                    <span className="text-sm font-medium text-slate-800">{c.student.firstName} {c.student.lastName}</span>
                    {c.isRevealed && <Badge className="bg-emerald-100 text-emerald-800 border-0 text-[10px]">Revealed</Badge>}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-xs"
                    disabled={revealMutation.isPending}
                    onClick={() => revealMutation.mutate({ scope: 'certificate', certificateId: c.id, isRevealed: !c.isRevealed })}
                  >
                    {c.isRevealed ? <><EyeOff className="w-3.5 h-3.5" /> Hide</> : <><Eye className="w-3.5 h-3.5" /> Reveal</>}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {printHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" /> Print History
            </CardTitle>
            <CardDescription>Every certificate export, so you can trace what was printed for each ceremony.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100">
            {printHistory.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedBatchId(b.id)}
                className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 text-sm text-left rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div>
                  <p className="font-medium text-slate-800">{b.label}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(b.createdAt).toLocaleDateString('en-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">{b.totalCount} certificate{b.totalCount === 1 ? '' : 's'}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedBatchId} onOpenChange={(o) => { if (!o) closeBatchDialog() }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{batchDetail?.batch.label ?? 'Print batch'}</DialogTitle>
            <DialogDescription>
              {batchDetail && (
                <>
                  Created {new Date(batchDetail.batch.createdAt).toLocaleDateString('en-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {batchDetail.certificates.length} certificate{batchDetail.certificates.length === 1 ? '' : 's'}
                  {batchDetail.batch.printedByName && <> · Printed by {batchDetail.batch.printedByName}</>}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {isBatchLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : batchDetail ? (
            <div className="space-y-4">
              <div className="border border-slate-100 rounded-xl divide-y divide-slate-100">
                {batchDetail.certificates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No certificates in this batch.</p>
                ) : (
                  batchDetail.certificates.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-800">{c.studentName}</p>
                        <p className="text-xs text-slate-400">{c.courseName || 'Uncategorized'} · {c.certificateNumber}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={updateBatchMutation.isPending}
                        onClick={() => handleRemoveFromBatch(c.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">Add a certificate</p>
                <Input
                  placeholder="Search by student name or certificate number..."
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                />
                {addSearchResults.length > 0 && (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-40 overflow-y-auto">
                    {addSearchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={updateBatchMutation.isPending}
                        onClick={() => handleAddToBatch(c.id)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-slate-50 disabled:opacity-50"
                      >
                        <span className="text-slate-800">{c.student.firstName} {c.student.lastName} — {c.subject?.name ?? 'Uncategorized'}</span>
                        <span className="text-xs text-slate-400 font-mono">{c.certificateNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setConfirmDeleteBatch(true)}
            >
              Delete Batch
            </Button>
            <Button
              className="gap-1.5"
              disabled={isRedownloading || !batchDetail || batchDetail.certificates.length === 0}
              onClick={handleRedownloadBatch}
            >
              {isRedownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Re-download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteBatch} onOpenChange={setConfirmDeleteBatch}>
        <AlertDialogContent className="rounded-2xl max-w-md p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-slate-900">Delete this print batch?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed">
              This only removes the print-history record. The certificates themselves are not affected and stay available to reveal or print again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 flex-col-reverse sm:flex-row">
            <AlertDialogCancel className="h-10 text-xs sm:text-sm rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                disabled={deleteBatchMutation.isPending}
                onClick={() => deleteBatchMutation.mutate()}
              >
                {deleteBatchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
