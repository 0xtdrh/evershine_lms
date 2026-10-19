'use client'

/**
 * 2026-10-19 ID cards (5-E): print student cards (by group or place) and staff cards (by place) on A4, 10 per sheet —
 * fronts first, then the backs mirrored for double-sided printing. Replace a lost card (new QR; the old one stops
 * working), see a card's history, and the card settings. Permission: documents (read / create / update).
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CreditCard, History, Loader2, Printer, RefreshCw } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'
import { campusLabel } from '@/lib/places/label'
import { CardBack, CardFront, type IdCardData } from '@/components/cards/IdCard'
import { mirroredBacks, sheets } from '@/lib/cards/rules'

interface Ref { id: string; name?: string; label?: string; partner?: { name: string } | null }
interface Settings { validityMonths: number; emergencyOnBack: boolean; replacementFeeTypeId: string | null; digitalForParents: boolean; digitalForStudents: boolean }
interface HistoryRow { id: string; code: string; action: string; reason: string | null; createdAt: string }

const dmy = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export default function CardsPage() {
  useI18n()
  const { can, ready, role } = useMyPermissions()
  const allowed = can('documents', 'read')
  const [tab, setTab] = useUrlTab()
  if (!role || !ready) return null
  if (!allowed) return <AccessDenied title={L('ID Cards', 'الكارنيهات')} message={L("You don't have access to ID cards.", 'مش مسموح لك تفتح الكارنيهات.')} />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CreditCard className="h-7 w-7 text-blue-700" /> {L('ID Cards', 'الكارنيهات')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {L('Print cards on A4 (10 per sheet, credit-card size). Print the fronts, put the paper back in, then print the backs. The QR opens a check page: anyone sees only "valid / not valid"; staff see the person.',
            'اطبع الكارنيهات على ورق A4 (10 في الورقة، مقاس الكريدت كارد). اطبع الوش، رجّع الورق، واطبع الضهر. الـ QR بيفتح صفحة تأكيد: أي حد يشوف «شغال / مش شغال» بس، والموظفين يشوفوا الشخص.')}
        </p>
      </div>
      <Tabs value={tab ?? 'students'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="students">{L('Students', 'الطلاب')}</TabsTrigger>
          <TabsTrigger value="staff">{L('Staff', 'الموظفين')}</TabsTrigger>
          <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>
        </TabsList>
        <TabsContent value="students"><CardsTab kind="STUDENT" canReplace={can('documents', 'create')} /></TabsContent>
        <TabsContent value="staff"><CardsTab kind="STAFF" canReplace={can('documents', 'create')} /></TabsContent>
        <TabsContent value="settings"><SettingsTab canEdit={can('documents', 'update')} /></TabsContent>
      </Tabs>
    </div>
  )
}

function CardsTab({ kind, canReplace }: { kind: 'STUDENT' | 'STAFF'; canReplace: boolean }) {
  const qc = useQueryClient()
  const [groupId, setGroupId] = useState('')
  const [campusId, setCampusId] = useState('')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [replace, setReplace] = useState<IdCardData | null>(null)
  const [history, setHistory] = useState<IdCardData | null>(null)
  const { data: campuses } = useQuery({ queryKey: ['campuses-list'], queryFn: () => fetchApi<Ref[]>('/api/campuses') })
  const { data: groups } = useQuery({ queryKey: ['groups-list-active'], queryFn: () => fetchApi<Ref[]>('/api/groups?status=ACTIVE'), enabled: kind === 'STUDENT' })
  const qs = new URLSearchParams({ kind, ...(groupId && { groupId }), ...(campusId && { campusId }) }).toString()
  const chosen = kind === 'STUDENT' ? !!(groupId || campusId) : !!campusId
  const { data: cards, isLoading } = useQuery({ queryKey: ['id-cards', qs], queryFn: () => fetchApi<IdCardData[]>(`/api/cards?${qs}`), enabled: chosen })
  const list = cards ?? []
  const selected = useMemo(() => list.filter((c) => !picked || picked.has(c.id)), [list, picked])
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p ?? list.map((c) => c.id)); n.has(id) ? n.delete(id) : n.add(id); return n })
  const print = (which: 'front' | 'back') => {
    if (!selected.length) return
    setSide(which)
    setTimeout(() => {
      window.print()
      if (which === 'front') fetch('/api/cards/printed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: selected.map((c) => ({ kind: c.kind, id: c.id, code: c.code })) }) }).catch(() => undefined)
    }, 300)
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'STUDENT' && (
          <Select value={groupId || 'none'} onValueChange={(v) => { setGroupId(v === 'none' ? '' : v); setPicked(null) }}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder={L('Group', 'المجموعة')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{L('— Any group —', '— أي مجموعة —')}</SelectItem>
              {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.label ?? g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={campusId || 'none'} onValueChange={(v) => { setCampusId(v === 'none' ? '' : v); setPicked(null) }}>
          <SelectTrigger className="h-9 w-56"><SelectValue placeholder={L('Place', 'المكان')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{L('— Any place —', '— أي مكان —')}</SelectItem>
            {(campuses ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" disabled={!selected.length} onClick={() => print('front')}><Printer className="me-1 h-4 w-4" /> {L('Print fronts', 'اطبع الوش')}</Button>
          <Button variant="outline" disabled={!selected.length} onClick={() => print('back')}><Printer className="me-1 h-4 w-4" /> {L('Print backs', 'اطبع الضهر')}</Button>
        </div>
      </div>

      {!chosen ? (
        <p className="text-sm text-slate-500">{kind === 'STUDENT' ? L('Choose a group or a place.', 'اختار مجموعة أو مكان.') : L('Choose a place.', 'اختار مكان.')}</p>
      ) : isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : !list.length ? (
        <p className="text-sm text-slate-500">{L('Nobody here.', 'مفيش حد هنا.')}</p>
      ) : (
        <>
          <p className="text-sm text-slate-600">{L(`${selected.length} of ${list.length} selected`, `متحدد ${selected.length} من ${list.length}`)} · {L(`${sheets(selected).length} sheet(s)`, `${sheets(selected).length} ورقة`)}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <Card key={c.id} className={picked && !picked.has(c.id) ? 'opacity-50' : ''}>
                <CardContent className="space-y-2 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!picked || picked.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="font-medium text-slate-800">{c.nameEn}</span>
                    <span className="ms-auto text-xs text-slate-500">{L('until', 'لحد')} {dmy(c.validUntil)}</span>
                  </label>
                  <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', height: '50mm' }}><CardFront c={c} /></div>
                  <div className="flex gap-2">
                    {canReplace && <Button size="sm" variant="outline" onClick={() => setReplace(c)}><RefreshCw className="me-1 h-3.5 w-3.5" /> {L('Lost card', 'كارنيه ضايع')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setHistory(c)}><History className="me-1 h-3.5 w-3.5" /> {L('History', 'السجل')}</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <PrintSheets cards={selected} side={side} origin={origin} />
      {replace && <ReplaceDialog card={replace} onClose={() => setReplace(null)} onDone={() => { setReplace(null); qc.invalidateQueries({ queryKey: ['id-cards'] }) }} />}
      {history && <HistoryDialog card={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

/** Only this part is printed: A4 sheets, 2 × 5 cards; backs mirrored per row so double-sided printing lines up. */
function PrintSheets({ cards, side, origin }: { cards: IdCardData[]; side: 'front' | 'back'; origin: string }) {
  return (
    <div id="cards-print" className="keep-light" aria-hidden>
      <style>{`
        #cards-print { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          #cards-print, #cards-print * { visibility: visible !important; }
          #cards-print { display: block !important; position: absolute; left: 0; top: 0; width: 210mm; }
          #cards-print .sheet { width: 210mm; height: 297mm; padding: 13.5mm 15mm; box-sizing: border-box; display: grid; grid-template-columns: 85.6mm 85.6mm; grid-auto-rows: 54mm; column-gap: 8.8mm; row-gap: 0; align-content: start; page-break-after: always; break-after: page; }
          #cards-print .slot { width: 85.6mm; height: 54mm; }
        }
      `}</style>
      {sheets(cards).map((sheet, i) => (
        <div key={i} className="sheet">
          {(side === 'front' ? sheet : mirroredBacks(sheet)).map((c, j) => (
            <div key={j} className="slot">{c ? (side === 'front' ? <CardFront c={c} /> : <CardBack c={c} origin={origin} />) : null}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ReplaceDialog({ card, onClose, onDone }: { card: IdCardData; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [chargeFee, setChargeFee] = useState(false)
  const { data } = useQuery({ queryKey: ['card-settings'], queryFn: () => fetchApi<{ settings: Settings }>('/api/cards/settings') })
  const hasFee = !!data?.settings.replacementFeeTypeId && card.kind === 'STUDENT'
  const m = useMutation({
    mutationFn: () => fetchApi('/api/cards/replace', { method: 'POST', body: JSON.stringify({ kind: card.kind, id: card.id, reason: reason || null, chargeFee: hasFee && chargeFee }) }),
    onSuccess: () => { notify.success(L('New card made — the old one no longer works', 'اتعمل كارنيه جديد — القديم مبقاش شغال')); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{L('Replace a lost card', 'بدل فاقد')} — {card.nameEn}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">{L('A new QR code is made. The old card stops working everywhere (check page, attendance scan, stamps).', 'هيتعمل QR جديد. الكارنيه القديم هيبطل يشتغل في كل حتة (صفحة التأكيد، تسجيل الحضور، الأختام).')}</p>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('Reason (e.g. lost, broken)', 'السبب (مثلاً ضاع، اتكسر)')} maxLength={200} />
        {hasFee && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chargeFee} onChange={(e) => setChargeFee(e.target.checked)} /> {L('Charge the replacement fee', 'احسب رسوم بدل الفاقد')}</label>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{L('Cancel', 'إلغاء')}</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Make a new card', 'اعمل كارنيه جديد')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ACTION: Record<string, () => string> = { ISSUED: () => L('Issued', 'اتعمل'), REPLACED: () => L('Replaced', 'بدل فاقد'), PRINTED: () => L('Printed', 'اتطبع') }

function HistoryDialog({ card, onClose }: { card: IdCardData; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['card-history', card.kind, card.id], queryFn: () => fetchApi<HistoryRow[]>(`/api/cards/history?kind=${card.kind}&id=${card.id}`) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{L('Card history', 'سجل الكارنيه')} — {card.nameEn}</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <ul className="max-h-80 space-y-1 overflow-auto text-sm">
            {(data ?? []).map((h) => (
              <li key={h.id} className="flex gap-2 border-b border-slate-100 py-1">
                <span className="w-20 font-medium">{ACTION[h.action]?.() ?? h.action}</span>
                <span className="text-slate-500">{new Date(h.createdAt).toLocaleString('en-GB')}</span>
                <span className="ms-auto font-mono text-xs text-slate-500">{h.code}</span>
                {h.reason && <span className="text-slate-600">· {h.reason}</span>}
              </li>
            ))}
            {!data?.length && <li className="text-slate-500">{L('Nothing yet.', 'لسه مفيش.')}</li>}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['card-settings'], queryFn: () => fetchApi<{ settings: Settings; feeTypes: { id: string; nameEn: string; nameAr: string | null }[] }>('/api/cards/settings') })
  const [draft, setDraft] = useState<Settings | null>(null)
  const s = draft ?? data?.settings
  const m = useMutation({
    mutationFn: () => fetchApi('/api/cards/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setDraft(null); qc.invalidateQueries({ queryKey: ['card-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!s) return <Loader2 className="mt-4 h-5 w-5 animate-spin" />
  const set = (p: Partial<Settings>) => setDraft({ ...s, ...p })
  const box = (key: 'emergencyOnBack' | 'digitalForParents' | 'digitalForStudents', label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={s[key]} onChange={(e) => set({ [key]: e.target.checked })} /> {label}</label>
  )
  return (
    <Card className="mt-2 max-w-xl">
      <CardContent className="space-y-4 p-4">
        <label className="block text-sm">{L('A new card is valid for (months)', 'الكارنيه الجديد صالح لمدة (شهور)')}
          <Input type="number" min={1} max={60} disabled={!canEdit} className="mt-1 w-32" value={s.validityMonths} onChange={(e) => set({ validityMonths: Number(e.target.value) || 12 })} />
        </label>
        {box('emergencyOnBack', L('Print the emergency phone on the back', 'اطبع رقم الطوارئ على الضهر'))}
        {box('digitalForParents', L('Parents see the digital card in the portal', 'ولي الأمر يشوف الكارنيه الرقمي في البوابة'))}
        {box('digitalForStudents', L('Students see their digital card', 'الطالب يشوف الكارنيه الرقمي بتاعه'))}
        <label className="block text-sm">{L('Replacement fee (lost card)', 'رسوم بدل الفاقد')}
          <Select disabled={!canEdit} value={s.replacementFeeTypeId ?? 'none'} onValueChange={(v) => set({ replacementFeeTypeId: v === 'none' ? null : v })}>
            <SelectTrigger className="mt-1 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{L('Free', 'مجاني')}</SelectItem>
              {(data?.feeTypes ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.nameAr ? `${f.nameEn} — ${f.nameAr}` : f.nameEn}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="mt-1 block text-xs text-slate-500">{L('Make the fee in Money → Fees & Charges first.', 'اعمل الرسوم الأول من الحسابات ← الرسوم والمصاريف.')}</span>
        </label>
        {canEdit && <Button onClick={() => m.mutate()} disabled={!draft || m.isPending}>{L('Save', 'حفظ')}</Button>}
      </CardContent>
    </Card>
  )
}
