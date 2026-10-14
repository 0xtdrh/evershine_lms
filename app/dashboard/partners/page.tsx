'use client'

/** M1: Partners (schools, nurseries, centres, …) — the list + add a partner. Places, contracts and permissions live on each partner. */

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AccessDenied } from '@/components/AccessDenied'
import { PARTNER_KINDS, type PartnerKind } from '@/lib/partners/rules'
import { ContractBadge, kindLabel } from '@/components/partners/bits'
import { Handshake, Loader2, MapPin, Plus, Search } from 'lucide-react'

interface Row {
  id: string; name: string; kind: PartnerKind; contactName: string | null; contactPhone: string | null; isActive: boolean
  places: number; activeGroups: number
  contract: { id: string; title: string; endDate: string | null; state: string; daysLeft: number | null } | null
}

const empty = { name: '', kind: 'SCHOOL' as PartnerKind, contactName: '', contactPhone: '', contactEmail: '', address: '' }

export default function PartnersPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canRead = !!perms?.permissions?.partners?.includes('read')
  const canCreate = !!perms?.permissions?.partners?.includes('create')
  const { data: rows, isLoading, error } = useQuery({ queryKey: ['partners'], queryFn: () => fetchApi<Row[]>('/api/partners'), enabled: canRead })
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const add = useMutation({
    mutationFn: () => fetchApi<{ id: string }>('/api/partners', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { notify.success(L('Partner added', 'الشريك اتضاف')); setForm(empty); setOpen(false); qc.invalidateQueries({ queryKey: ['partners'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (perms && !canRead) return <AccessDenied />
  const list = (rows ?? []).filter((r) => !q || `${r.name} ${r.contactName ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Handshake className="h-5 w-5 text-indigo-600" />{L('Partners', 'الشركاء')}</h1>
          <p className="text-sm text-slate-500">{L('Schools, nurseries, centres and other places we work with. Their places, contracts and permissions are on each partner.', 'المدارس والحضانات والسناتر وغيرها اللي بنشتغل معاها. أماكنهم وعقودهم وصلاحياتهم جوه كل شريك.')}</p>
        </div>
        {canCreate && <Button size="sm" onClick={() => setOpen(!open)}><Plus className="me-1 h-4 w-4" />{L('Add partner', 'ضيف شريك')}</Button>}
      </div>

      {open && canCreate && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{L('New partner', 'شريك جديد')}</CardTitle><CardDescription>{L('You add its places and contracts after saving.', 'الأماكن والعقود بتضيفها بعد الحفظ.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">{L('Name', 'الاسم')}</Label><Input className="h-9" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('Type', 'النوع')}</Label>
              <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PartnerKind })}>
                {PARTNER_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">{L('Contact person', 'الشخص المسؤول')}</Label><Input className="h-9" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('Phone', 'التليفون')}</Label><Input className="h-9" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('Email', 'الإيميل')}</Label><Input className="h-9" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('Address', 'العنوان')}</Label><Input className="h-9" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={add.isPending || form.name.trim().length < 2} onClick={() => add.mutate()}>{add.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>{L('Cancel', 'إلغاء')}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute start-2 top-2.5 h-4 w-4 text-slate-400" />
        <Input className="h-9 ps-8" placeholder={L('Search partners', 'دوّر على شريك')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <p className="text-sm text-rose-600">{(error as Error).message}</p>
      ) : list.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">{L('No partners yet.', 'لسه مفيش شركاء.')}</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} href={`/dashboard/partners/${p.id}`} className="block">
              <Card className={`h-full transition hover:border-indigo-300 hover:shadow-sm ${p.isActive ? '' : 'opacity-60'}`}>
                <CardContent className="space-y-2 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">{kindLabel(p.kind)}{p.contactName ? ` · ${p.contactName}` : ''}</p>
                    </div>
                    {!p.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{L('Stopped', 'موقوف')}</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{p.places} {L('places', 'أماكن')}</span>
                    <span>{p.activeGroups} {L('active groups', 'جروب شغال')}</span>
                  </div>
                  {p.contract ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="truncate">{p.contract.title}</span>
                      <ContractBadge state={p.contract.state} daysLeft={p.contract.daysLeft} />
                    </div>
                  ) : <p className="text-xs text-slate-400">{L('No contract recorded', 'مفيش عقد متسجل')}</p>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
