'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { Loader2, Eye, EyeOff, Sparkles, PartyPopper, CheckSquare, Square, Download, FileStack, History } from 'lucide-react'
import { buildCertificatesPdf, groupByCourse, safeFilename, type PrintCertificate } from '@/lib/certificates/pdf-renderer'

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

  const handleDownload = async (mode: 'GROUPED' | 'COMBINED') => {
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
        { method: 'POST', body: JSON.stringify({ certificateIds: Array.from(selectedIds), mode, label }) }
      )

      if (res.certificates.every((c) => !c.template)) {
        notify.error('None of the selected certificates have a design template. Upload one in Certificate Designer first.')
        return
      }

      if (mode === 'COMBINED') {
        const pdf = await buildCertificatesPdf(res.certificates)
        if (!pdf) { notify.error('Nothing to render'); return }
        pdf.save(`${safeFilename(label)}.pdf`)
      } else {
        const groups = groupByCourse(res.certificates)
        for (const [courseName, certs] of groups) {
          const pdf = await buildCertificatesPdf(certs)
          if (!pdf) continue
          pdf.save(`${safeFilename(label)}-${safeFilename(courseName)}.pdf`)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['certificate-print-history'] })
      notify.success(`${res.certificates.length} certificate${res.certificates.length === 1 ? '' : 's'} exported`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to generate PDF')
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
              onClick={() => handleDownload('GROUPED')}>
              {isPrinting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileStack className="w-3.5 h-3.5" />} PDF per Course
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={isPrinting}
              onClick={() => handleDownload('COMBINED')}>
              {isPrinting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Single PDF
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
              <div key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{b.label}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(b.createdAt).toLocaleDateString('en-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}{b.mode === 'COMBINED' ? 'Single PDF' : 'PDF per course'}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">{b.totalCount} certificate{b.totalCount === 1 ? '' : 's'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
