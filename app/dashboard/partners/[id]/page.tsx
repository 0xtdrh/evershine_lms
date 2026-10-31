'use client'

/** M1: one partner — details, places, contracts (+ files and renewal alert), and permissions for its places. */

import { use } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AccessDenied } from '@/components/AccessDenied'
import { kindLabel } from '@/components/partners/bits'
import { PartnerInfoForm } from '@/components/partners/PartnerInfoForm'
import { PartnerPlaces } from '@/components/partners/PartnerPlaces'
import { PartnerContracts } from '@/components/partners/PartnerContracts'
import { PartnerDeals } from '@/components/partners/PartnerDeals'
import { PartnerStatements } from '@/components/partners/PartnerStatements'
import { PlacePermissions } from '@/components/partners/PlacePermissions'
import type { PartnerDetail } from '@/components/partners/types'
import { ArrowLeft, FileText, Handshake, Loader2 } from 'lucide-react'
import { PlacePeople } from '@/components/places/PlacePeople'
import { PlacePrograms } from '@/components/places/PlacePrograms'
import { PlaceRooms } from '@/components/places/PlaceRooms'
import { PartnerRelations } from '@/components/partners/PartnerRelations'

export default function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const isSuper = session?.user?.role === 'SUPER_ADMIN'
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const can = (a: string) => !!perms?.permissions?.partners?.includes(a)
  const fin = (a: string) => !!perms?.permissions?.partner_finance?.includes(a)
  const { data: p, isLoading, error } = useQuery({ queryKey: ['partner', id], queryFn: () => fetchApi<PartnerDetail>(`/api/partners/${id}`), enabled: can('read') })
  if (perms && !can('read')) return <AccessDenied />
  if (isLoading || !perms) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  if (error || !p) return <p className="text-sm text-rose-600">{(error as Error)?.message ?? L('Not found', 'مش موجود')}</p>
  return (
    <div className="space-y-4">
      <Link href="/dashboard/partners" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />{L('All partners', 'كل الشركاء')}</Link>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Handshake className="h-5 w-5 text-indigo-600" />{p.name}</h1>
        <p className="text-sm text-slate-500">{kindLabel(p.kind)}{!p.isActive ? ` · ${L('Stopped', 'موقوف')}` : ''}</p>
        <a href={`/reports/partner/${p.id}`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"><FileText className="h-3.5 w-3.5" />{L('Partner report (PDF)', 'تقرير الشريك (PDF)')}</a>
      </div>
      <Tabs defaultValue="places">
        <TabsList className="flex-wrap">
          <TabsTrigger value="places">{L('Places', 'الأماكن')} ({p.places.length})</TabsTrigger>
          <TabsTrigger value="programs">{L('Programmes', 'البرامج')}</TabsTrigger>
          <TabsTrigger value="rooms">{L('Rooms', 'القاعات')}</TabsTrigger>
          <TabsTrigger value="people">{L('Groups · students · instructors', 'الجروبات · الطلاب · المدربين')}</TabsTrigger>
          <TabsTrigger value="relations">{L('Contacts & meetings', 'المسؤولين والاجتماعات')}</TabsTrigger>
          <TabsTrigger value="deals">{L('Deal', 'الاتفاق')}</TabsTrigger>
          {fin('read') && <TabsTrigger value="statements">{L('Statements', 'كشوف الحساب')}</TabsTrigger>}
          <TabsTrigger value="contracts">{L('Contracts', 'العقود')} ({p.contracts.length})</TabsTrigger>
          <TabsTrigger value="info">{L('Details', 'البيانات')}</TabsTrigger>
          {isSuper && <TabsTrigger value="permissions">{L('Permissions', 'الصلاحيات')}</TabsTrigger>}
        </TabsList>
        <Card className="mt-3"><CardContent className="p-4">
          <TabsContent value="places"><PartnerPlaces p={p} canEdit={can('update')} /></TabsContent>
          <TabsContent value="programs">{p.places.length ? <div className="space-y-5">{p.places.map((x) => <div key={x.id}><p className="mb-1 text-sm font-semibold">{x.name}</p><PlacePrograms campusId={x.id} /></div>)}</div> : <p className="text-sm text-slate-500">{L('Add a place first.', 'ضيف مكان الأول.')}</p>}</TabsContent>
          <TabsContent value="rooms">{p.places.length ? <div className="space-y-5">{p.places.map((x) => <div key={x.id}><p className="mb-1 text-sm font-semibold">{x.name}</p><PlaceRooms campusId={x.id} canEdit={can('update')} /></div>)}</div> : <p className="text-sm text-slate-500">{L('Add a place first.', 'ضيف مكان الأول.')}</p>}</TabsContent>
          <TabsContent value="people">{p.places.length ? <PlacePeople places={p.places.map((x) => ({ id: x.id, name: x.name }))} /> : <p className="text-sm text-slate-500">{L('Add a place first.', 'ضيف مكان الأول.')}</p>}</TabsContent>
          <TabsContent value="relations"><PartnerRelations partnerId={p.id} canEdit={can('update')} /></TabsContent>
          <TabsContent value="deals"><PartnerDeals p={p} canEdit={can('update')} /></TabsContent>
          {fin('read') && <TabsContent value="statements"><PartnerStatements p={p} perms={{ create: fin('create'), approve: fin('approve'), update: fin('update') }} /></TabsContent>}
          <TabsContent value="contracts"><PartnerContracts p={p} canEdit={can('update')} canDelete={can('delete')} /></TabsContent>
          <TabsContent value="info"><PartnerInfoForm p={p} canEdit={can('update')} canDelete={can('delete')} /></TabsContent>
          {isSuper && <TabsContent value="permissions"><PlacePermissions p={p} /></TabsContent>}
        </CardContent></Card>
      </Tabs>
    </div>
  )
}
