'use client'

/**
 * M1: contracts of a partner — dates, renewal alert (days before the end), notes, and private photos / PDF of the signed
 * contract (opened by a 2-minute link; every opening is recorded). Money terms come in M2.
 */

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CONTRACT_FILE_MAX_MB } from '@/lib/partners/rules'
import { ContractBadge } from './bits'
import type { PartnerContract, PartnerDetail } from './types'
import { FileText, Loader2, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'

interface Sign { timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }

const day = (s: string | null) => (s ? s.slice(0, 10) : '')
const blank = { title: '', startDate: '', endDate: '', alertDaysBefore: 30, notes: '' }

export function PartnerContracts({ p, canEdit, canDelete }: { p: PartnerDetail; canEdit: boolean; canDelete: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | 'NEW' | null>(null)
  const [f, setF] = useState(blank)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const target = useRef<string | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['partner', p.id] }); qc.invalidateQueries({ queryKey: ['partners'] }) }
  const save = useMutation({
    mutationFn: (body: typeof f) => editing === 'NEW'
      ? fetchApi(`/api/partners/${p.id}/contracts`, { method: 'POST', body: JSON.stringify(body) })
      : fetchApi(`/api/partner-contracts/${editing}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setEditing(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/partner-contracts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Deleted', 'اتمسح')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const delFile = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/partner-contract-files/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Deleted', 'اتمسح')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const open = (c: PartnerContract | null) => {
    setEditing(c ? c.id : 'NEW')
    setF(c ? { title: c.title, startDate: day(c.startDate), endDate: day(c.endDate), alertDaysBefore: c.alertDaysBefore, notes: c.notes ?? '' } : blank)
  }
  const openFile = async (id: string) => {
    try {
      const r = await fetchApi<{ url: string }>(`/api/partner-contract-files/${id}`)
      window.open(r.url, '_blank', 'noopener')
    } catch (e) { notify.error((e as Error).message) }
  }
  const upload = async (file: File) => {
    const contractId = target.current
    if (!contractId) return
    if (file.size > CONTRACT_FILE_MAX_MB * 1024 * 1024) { notify.error(L(`The file is larger than ${CONTRACT_FILE_MAX_MB} MB`, `الملف أكبر من ${CONTRACT_FILE_MAX_MB} ميجا`)); return }
    setUploading(contractId)
    try {
      const s = await fetchApi<Sign>(`/api/partners/${p.id}/files-sign`, { method: 'POST' })
      const fd = new FormData()
      fd.append('file', file); fd.append('api_key', s.apiKey); fd.append('timestamp', String(s.timestamp)); fd.append('signature', s.signature)
      fd.append('folder', s.folder); fd.append('allowed_formats', s.allowedFormats); fd.append('type', s.type)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
      await fetchApi(`/api/partner-contracts/${contractId}/files`, { method: 'POST', body: JSON.stringify({ publicId: j.public_id, resourceType: j.resource_type, format: j.format, bytes: j.bytes, originalName: file.name }) })
      notify.success(L('File added', 'الملف اتضاف'))
      refresh()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setUploading(null)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) upload(x) }} />
      {p.contracts.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">{L('No contracts yet.', 'لسه مفيش عقود.')}</p>}
      <ul className="space-y-2">
        {p.contracts.map((c) => (
          <li key={c.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-600" />
              <span className="font-medium text-slate-900">{c.title}</span>
              <ContractBadge state={c.state} daysLeft={c.daysLeft} />
              <span className="text-xs text-slate-500">{day(c.startDate)} → {c.endDate ? day(c.endDate) : L('no end date', 'من غير نهاية')} · {L('alert', 'تنبيه')} {c.alertDaysBefore} {L('days before', 'يوم قبلها')}</span>
              {canEdit && (
                <span className="ms-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={uploading === c.id} onClick={() => { target.current = c.id; fileInput.current?.click() }}>
                    {uploading === c.id ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Paperclip className="me-1 h-4 w-4" />}{L('Add photo / PDF', 'ضيف صورة / PDF')}
                  </Button>
                  {canDelete && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => confirm(L('Delete this contract and its files?', 'تمسح العقد ده وملفاته؟')) && del.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>}
                </span>
              )}
            </div>
            {c.notes && <p className="whitespace-pre-wrap text-xs text-slate-600">{c.notes}</p>}
            {c.files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {c.files.map((fl) => (
                  <li key={fl.id} className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs">
                    <button type="button" className="text-indigo-700 hover:underline" onClick={() => openFile(fl.id)}>{fl.originalName || `${L('File', 'ملف')}.${fl.format ?? ''}`}</button>
                    {canEdit && <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => confirm(L('Delete this file?', 'تمسح الملف ده؟')) && delFile.mutate(fl.id)} aria-label={L('Delete', 'امسح')}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {canEdit && editing === null && <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="me-1 h-4 w-4" />{L('Add contract', 'ضيف عقد')}</Button>}
      {canEdit && editing !== null && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{L('Title', 'العنوان')}</Label><Input className="h-9" placeholder={L('e.g. School year 2026/27', 'مثلًا العام الدراسي 2026/27')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Start', 'البداية')}</Label><Input type="date" className="h-9" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('End (empty = open-ended)', 'النهاية (فاضي = مفتوح)')}</Label><Input type="date" className="h-9" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Alert how many days before the end', 'التنبيه قبل النهاية بكام يوم')}</Label><Input type="number" min={0} max={365} className="h-9" value={f.alertDaysBefore} onChange={(e) => setF({ ...f, alertDaysBefore: Number(e.target.value) })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{L('Notes', 'ملاحظات')}</Label><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={save.isPending || f.title.trim().length < 2 || !f.startDate} onClick={() => save.mutate(f)}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>{L('Cancel', 'إلغاء')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
