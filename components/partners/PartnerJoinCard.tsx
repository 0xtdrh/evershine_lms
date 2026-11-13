'use client'

/** Six phases 1-C: the partner's join code + sign-up link + QR, on/off, a new code, and how many families came from it. */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { LinkQrBox } from '@/components/common/LinkQrBox'

type Join = { id: string; name: string; joinCode: string | null; joinActive: boolean; path: string | null; accounts: number; bookings: number; confirmed: number }

export function PartnerJoinCard({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['partner-join', partnerId], queryFn: () => fetchApi<Join>(`/api/partners/${partnerId}/join`) })
  const act = async (action: string) => {
    if (action === 'regenerate' && !confirm(L('Make a new code? The old link and QR stop working.', 'تعمل كود جديد؟ اللينك والـ QR القدام هيبطلوا.'))) return
    try { await fetchApi(`/api/partners/${partnerId}/join`, { method: 'POST', body: JSON.stringify({ action }) }); void qc.invalidateQueries({ queryKey: ['partner-join', partnerId] }) } catch (e) { notify.error((e as Error).message) }
  }
  if (!data) return <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">{L('Families who sign up with this code or link are tied to this partner: they see its places, groups and prices, and are counted for the partner.', 'العائلات اللي بتسجّل بالكود أو اللينك ده بتتربط بالشريك: بيشوفوا أماكنه وجروباته وأسعاره، وبيتحسبوا للشريك.')}</p>
      {!data.joinCode ? (
        canEdit ? <button type="button" onClick={() => void act('create')} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">{L('Make the join code', 'اعمل كود الانضمام')}</button> : <p className="text-slate-500">{L('No join code yet.', 'مفيش كود انضمام لسه.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-lg font-bold" dir="ltr">{data.joinCode}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${data.joinActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{data.joinActive ? L('on', 'شغال') : L('stopped', 'متوقف')}</span>
            {canEdit ? <>
              <button type="button" onClick={() => void act(data.joinActive ? 'off' : 'on')} className="rounded-lg border border-slate-300 px-3 py-1.5">{data.joinActive ? L('Stop', 'وقّف') : L('Start', 'شغّل')}</button>
              <button type="button" onClick={() => void act('regenerate')} className="rounded-lg border border-slate-300 px-3 py-1.5">{L('New code', 'كود جديد')}</button>
            </> : null}
          </div>
          {data.path ? <LinkQrBox path={data.path} fileName={`join-${data.joinCode}`} whatsappText={`سجّل ولادك في TechNova عن طريق ${data.name}:`} /> : null}
          <p className="text-slate-700">{L(`${data.accounts} families signed up · ${data.bookings} bookings (${data.confirmed} confirmed)`, `${data.accounts} عيلة سجّلت · ${data.bookings} حجز (${data.confirmed} اتأكد)`)}</p>
        </>
      )}
    </div>
  )
}
