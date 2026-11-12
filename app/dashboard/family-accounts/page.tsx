'use client'

/**
 * Six phases 1-A: family accounts. Families sign up on the website (or staff make the account for a family that came to a
 * branch and send it a link to choose its password). Staff see each account, its children, send a new password link, and
 * open a track / course outside the child's age. Settings: sign-up open, unsuitable courses lock / hide, e-mail check.
 * APIs /api/family-accounts*. RBAC family_accounts (read / create / update), places (lib/accounts/staff.ts).
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { whatsappNumber } from '@/lib/students/portal-password'

type Row = { id: string; firstName: string; lastName: string; phoneNumber: string; email: string | null; signupSource: string | null; selfAccount: boolean; city: string | null; createdAt: string; members: number; students: number; lastLogin: string | null }
type Person = { key: string; memberId: string | null; studentId: string | null; firstName: string; lastName: string; age: number | null; registrationNumber: string | null }
type Detail = {
  account: { id: string; firstName: string; lastName: string; phoneNumber: string; email: string | null; relationship: string; signupSource: string | null; country: string | null; city: string | null; createdAt: string; user: { lastLogin: string | null; emailVerified: boolean } }
  people: Person[]
  unlocks: { id: string; refType: string; name: string; forWho: string; note: string | null; createdAt: string }[]
  link: { createdAt: string; expiresAt: string; usedAt: string | null } | null
  options: { tracks: { id: string; name: string; minAge: number | null; maxAge: number | null }[]; courses: { id: string; name: string }[] }
}
type Settings = { signupOpen: boolean; unsuitable: 'LOCK' | 'HIDE'; emailCheck: boolean; linkDays: number }

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const btn = 'rounded-lg px-3 py-2 text-sm font-semibold'
const day = (d: string | null, ar: boolean) => (d ? new Date(d).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const SOURCE: Record<string, [string, string]> = { WEBSITE: ['Website', 'الموقع'], STAFF: ['Branch', 'الفرع'] }

function LinkBox({ path, phone, name }: { path: string; phone: string; name: string }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  const wa = whatsappNumber(phone)
  const text = `أهلاً ${name}، ده لينك حسابك في TechNova. افتحه واختار الباسورد بتاعك، وبعدها ضيف ولادك واختار كورساتهم:\n${url}`
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-semibold text-emerald-900">{L('Send this link to the family (works once):', 'ابعت اللينك ده للعيلة (بيشتغل مرة واحدة):')}</p>
      <p className="mt-1 break-all font-mono text-xs" dir="ltr">{url}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={`${btn} border border-emerald-300 bg-white`} onClick={() => { void navigator.clipboard?.writeText(url); notify.success(L('Copied', 'اتنسخ')) }}>{L('Copy', 'انسخ')}</button>
        {wa ? <a className={`${btn} bg-emerald-600 text-white`} href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{L('Send on WhatsApp', 'ابعت واتساب')}</a> : null}
      </div>
    </div>
  )
}

export default function FamilyAccountsPage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { can, role } = useMyPermissions()
  const [tab, setTab] = useUrlTab()
  const [filter, setFilter] = useState('ALL')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['family-accounts', filter, q], queryFn: () => fetchApi<Row[]>(`/api/family-accounts?filter=${filter}&q=${encodeURIComponent(q)}`) })
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN'
  const current = tab ?? 'accounts'

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{L('Family accounts', 'حسابات العائلات')}</h1>
        <p className="mt-1 text-sm text-slate-600">{L('Families make an account on the website (or you make it for a family at the branch), add their children and see the courses that suit them.', 'العائلات بتعمل حساب من الموقع (أو انت تعمله لعيلة جت الفرع)، وتضيف ولادها وتشوف الكورسات المناسبة.')}</p>
      </div>
      <div className="flex gap-2 border-b border-slate-200" role="tablist">
        {[['accounts', L('Accounts', 'الحسابات')], ...(can('family_accounts', 'create') ? [['new', L('New account', 'حساب جديد')]] : []), ...(isAdmin ? [['settings', L('Settings', 'الإعدادات')]] : [])].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={current === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${current === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600'}`}>{label}</button>
        ))}
      </div>

      {current === 'accounts' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {[['ALL', L('All', 'الكل')], ['WEBSITE', L('From the website', 'من الموقع')], ['STAFF', L('Made at a branch', 'اتعملت في الفرع')], ['NO_BOOKING', L('No student yet', 'لسه مفيش طالب')]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700'}`}>{label}</button>
            ))}
            <input className={`${input} ms-auto max-w-xs`} placeholder={L('Name, phone, e-mail…', 'الاسم أو الموبايل أو الإيميل…')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="p-2 text-start">{L('Account', 'الحساب')}</th><th className="p-2 text-start">{L('Mobile', 'الموبايل')}</th><th className="p-2 text-start">{L('From', 'من')}</th>
                <th className="p-2 text-start">{L('Children / students', 'الأولاد / الطلاب')}</th><th className="p-2 text-start">{L('Made', 'اتعمل')}</th><th className="p-2 text-start">{L('Last sign-in', 'آخر دخول')}</th>
              </tr></thead>
              <tbody>
                {list.isLoading ? <tr><td colSpan={6} className="p-3 text-slate-500">{L('Loading…', 'بيحمّل…')}</td></tr> : !list.data?.length ? <tr><td colSpan={6} className="p-3 text-slate-500">{L('No accounts.', 'مفيش حسابات.')}</td></tr> : list.data.map((r) => (
                  <tr key={r.id} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${open === r.id ? 'bg-blue-50/50' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="p-2 font-medium text-slate-900">{r.firstName} {r.lastName}{r.selfAccount ? <span className="ms-1 rounded bg-slate-100 px-1 text-xs text-slate-600">{L('student 18+', 'طالب 18+')}</span> : null}</td>
                    <td className="p-2" dir="ltr">{r.phoneNumber}</td>
                    <td className="p-2">{r.signupSource ? (ar ? SOURCE[r.signupSource]?.[1] : SOURCE[r.signupSource]?.[0]) ?? r.signupSource : L('Admission', 'طلب التحاق')}</td>
                    <td className="p-2">{r.members} / {r.students}</td>
                    <td className="p-2">{day(r.createdAt, ar)}</td>
                    <td className="p-2">{day(r.lastLogin, ar)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open ? <AccountPanel id={open} canUpdate={can('family_accounts', 'update')} /> : null}
        </section>
      ) : null}

      {current === 'new' ? <NewAccount onDone={() => void qc.invalidateQueries({ queryKey: ['family-accounts'] })} /> : null}
      {current === 'settings' && isAdmin ? <SettingsTab /> : null}
    </div>
  )
}

function AccountPanel({ id, canUpdate }: { id: string; canUpdate: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['family-account', id], queryFn: () => fetchApi<Detail>(`/api/family-accounts/${id}`) })
  const [link, setLink] = useState<string | null>(null)
  const [u, setU] = useState({ person: '', refType: 'TRACK', refId: '', note: '' })
  if (!data) return <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
  const a = data.account
  const newLink = async () => {
    try { const r = await fetchApi<{ link: string }>(`/api/family-accounts/${id}/link`, { method: 'POST' }); setLink(r.link); void qc.invalidateQueries({ queryKey: ['family-account', id] }) } catch (e) { notify.error((e as Error).message) }
  }
  const addUnlock = async () => {
    try {
      await fetchApi(`/api/family-accounts/${id}/unlocks`, { method: 'POST', body: JSON.stringify({ refType: u.refType, refId: u.refId, person: u.person || null, note: u.note || null }) })
      notify.success(L('Opened', 'اتفتح')); setU({ ...u, refId: '', note: '' })
      void qc.invalidateQueries({ queryKey: ['family-account', id] })
    } catch (e) { notify.error((e as Error).message) }
  }
  const delUnlock = async (unlockId: string) => {
    try { await fetchApi(`/api/family-accounts/${id}/unlocks?unlockId=${unlockId}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['family-account', id] }) } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <div className="grid gap-4 rounded-xl border border-blue-200 bg-white p-4 lg:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{a.firstName} {a.lastName}</h2>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="text-slate-500">{L('Mobile', 'الموبايل')}</dt><dd dir="ltr" className="text-start">{a.phoneNumber}</dd>
          <dt className="text-slate-500">{L('E-mail', 'الإيميل')}</dt><dd>{a.email || '—'}{a.email ? (a.user.emailVerified ? ' ✓' : ` (${L('not confirmed', 'مش متأكد')})`) : ''}</dd>
          <dt className="text-slate-500">{L('Place', 'المكان')}</dt><dd>{[a.city, a.country].filter(Boolean).join('، ') || '—'}</dd>
          <dt className="text-slate-500">{L('Last sign-in', 'آخر دخول')}</dt><dd>{day(a.user.lastLogin, ar)}</dd>
          <dt className="text-slate-500">{L('Password link', 'لينك الباسورد')}</dt><dd>{data.link ? (data.link.usedAt ? L('used', 'اتستخدم') + ' ' + day(data.link.usedAt, ar) : new Date(data.link.expiresAt) < new Date() ? L('expired', 'انتهى') : L('waiting until', 'مستني لحد') + ' ' + day(data.link.expiresAt, ar)) : '—'}</dd>
        </dl>
        {canUpdate ? <button type="button" onClick={() => void newLink()} className={`${btn} border border-slate-300`}>{L('New password link', 'لينك باسورد جديد')}</button> : null}
        {link ? <LinkBox path={link} phone={a.phoneNumber} name={a.firstName} /> : null}
        <div>
          <h3 className="mb-1 font-semibold text-slate-900">{L('Family', 'العيلة')}</h3>
          {data.people.length ? <ul className="space-y-1 text-sm">{data.people.map((p) => <li key={p.key}>{p.firstName} {p.lastName}{p.age != null ? ` · ${L(`${p.age} y`, `${p.age} سنة`)}` : ''}{p.registrationNumber ? <span className="ms-1 text-emerald-700" dir="ltr">{p.registrationNumber}</span> : <span className="ms-1 text-slate-500">{L('(not registered yet)', '(لسه مش متسجل)')}</span>}</li>)}</ul> : <p className="text-sm text-slate-500">{L('No children added yet.', 'لسه مفيش أولاد.')}</p>}
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold text-slate-900">{L('Courses opened outside the age', 'كورسات اتفتحت بره السن')}</h3>
        {data.unlocks.length ? (
          <ul className="space-y-1 text-sm">{data.unlocks.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
              <span>{x.name} · {x.forWho === 'FAMILY' ? L('whole family', 'العيلة كلها') : x.forWho}{x.note ? <span className="text-slate-500"> — {x.note}</span> : null}</span>
              {canUpdate ? <button type="button" onClick={() => void delUnlock(x.id)} className="text-xs text-red-700">{L('Remove', 'شيل')}</button> : null}
            </li>
          ))}</ul>
        ) : <p className="text-sm text-slate-500">{L('None.', 'مفيش.')}</p>}
        {canUpdate ? (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
            <label className="text-sm">{L('For', 'لمين')}<select className={input} value={u.person} onChange={(e) => setU({ ...u, person: e.target.value })}><option value="">{L('Whole family', 'العيلة كلها')}</option>{data.people.map((p) => <option key={p.key} value={p.key}>{p.firstName}</option>)}</select></label>
            <label className="text-sm">{L('Kind', 'النوع')}<select className={input} value={u.refType} onChange={(e) => setU({ ...u, refType: e.target.value, refId: '' })}><option value="TRACK">{L('Track', 'تراك')}</option><option value="COURSE">{L('Course', 'كورس')}</option></select></label>
            <label className="text-sm sm:col-span-2">{u.refType === 'TRACK' ? L('Track', 'التراك') : L('Course', 'الكورس')}
              <select className={input} value={u.refId} onChange={(e) => setU({ ...u, refId: e.target.value })}><option value="">—</option>{(u.refType === 'TRACK' ? data.options.tracks : data.options.courses).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <label className="text-sm sm:col-span-2">{L('Why (optional)', 'السبب (اختياري)')}<input className={input} value={u.note} onChange={(e) => setU({ ...u, note: e.target.value })} /></label>
            <button type="button" disabled={!u.refId} onClick={() => void addUnlock()} className={`${btn} bg-blue-600 text-white disabled:opacity-50 sm:col-span-2`}>{L('Open it', 'افتحه')}</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function NewAccount({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ who: 'PARENT', firstName: '', lastName: '', phone: '', email: '', relationship: '', city: '' })
  const [kids, setKids] = useState<{ firstName: string; lastName: string; dob: string; gender: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ link: string; phone: string; name: string } | null>(null)
  const create = async () => {
    setBusy(true)
    try {
      const r = await fetchApi<{ link: string }>('/api/family-accounts', { method: 'POST', body: JSON.stringify({ ...f, email: f.email || null, relationship: f.relationship || null, city: f.city || null, members: kids.filter((k) => k.firstName) }) })
      setMade({ link: r.link, phone: f.phone, name: f.firstName })
      notify.success(L('Account made', 'الحساب اتعمل'))
      setF({ who: 'PARENT', firstName: '', lastName: '', phone: '', email: '', relationship: '', city: '' }); setKids([])
      onDone()
    } catch (e) { notify.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{L('For a family at the branch: make the account here, then send it the link to choose its own password (you never know it).', 'لعيلة في الفرع: اعمل الحساب هنا وابعتلها اللينك تختار الباسورد بنفسها (انت مش بتعرفه).')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">{L('Who', 'مين')}<select className={input} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}><option value="PARENT">{L('A parent', 'ولي أمر')}</option><option value="SELF">{L('The student (18+)', 'الطالب نفسه (18+)')}</option></select></label>
        <label className="text-sm">{L('First name', 'الاسم الأول')}<input className={input} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></label>
        <label className="text-sm">{L('Family name', 'اسم العيلة')}<input className={input} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label>
        <label className="text-sm">{L('Mobile', 'الموبايل')}<input dir="ltr" className={input} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="text-sm">{L('E-mail (optional)', 'الإيميل (اختياري)')}<input dir="ltr" className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="text-sm">{L('City', 'المدينة')}<input className={input} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
      </div>
      <div className="space-y-2">
        {kids.map((k, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-5">
            <input className={input} placeholder={L('First name', 'الاسم الأول')} value={k.firstName} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, firstName: e.target.value } : x)))} />
            <input className={input} placeholder={L('Family name', 'اسم العيلة')} value={k.lastName} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, lastName: e.target.value } : x)))} />
            <input type="date" dir="ltr" className={input} value={k.dob} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, dob: e.target.value } : x)))} />
            <select className={input} value={k.gender} onChange={(e) => setKids(kids.map((x, j) => (j === i ? { ...x, gender: e.target.value } : x)))}><option value="">—</option><option value="MALE">{L('Boy', 'ولد')}</option><option value="FEMALE">{L('Girl', 'بنت')}</option></select>
            <button type="button" onClick={() => setKids(kids.filter((_, j) => j !== i))} className="text-sm text-red-700">{L('Remove', 'شيل')}</button>
          </div>
        ))}
        <button type="button" onClick={() => setKids([...kids, { firstName: '', lastName: f.lastName, dob: '', gender: '' }])} className={`${btn} border border-slate-300`}>+ {L('Add a child (optional)', 'ضيف ابن / بنت (اختياري)')}</button>
      </div>
      <button type="button" disabled={busy || !f.firstName || !f.lastName || !f.phone} onClick={() => void create()} className={`${btn} bg-blue-600 text-white disabled:opacity-50`}>{busy ? L('Making…', 'بيتعمل…') : L('Make the account', 'اعمل الحساب')}</button>
      {made ? <LinkBox path={made.link} phone={made.phone} name={made.name} /> : null}
    </section>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['family-accounts-settings'], queryFn: () => fetchApi<{ settings: Settings; emailReady: boolean }>('/api/family-accounts/settings') })
  if (!data) return null
  const s = data.settings
  const save = async (patch: Partial<Settings>) => {
    try { await fetchApi('/api/family-accounts/settings', { method: 'PUT', body: JSON.stringify(patch) }); notify.success(L('Saved', 'اتحفظ')); void qc.invalidateQueries({ queryKey: ['family-accounts-settings'] }) } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={s.signupOpen} onChange={(e) => void save({ signupOpen: e.target.checked })} /> {L('Families may make an account on the website', 'العائلات تقدر تعمل حساب من الموقع')}</label>
      <div>
        <p className="font-semibold text-slate-900">{L('A course that does not suit the child’s age', 'الكورس اللي مش مناسب لسن الطفل')}</p>
        <label className="me-4 inline-flex items-center gap-2"><input type="radio" checked={s.unsuitable === 'LOCK'} onChange={() => void save({ unsuitable: 'LOCK' })} /> {L('Show it with a lock', 'يظهر بقفل')}</label>
        <label className="inline-flex items-center gap-2"><input type="radio" checked={s.unsuitable === 'HIDE'} onChange={() => void save({ unsuitable: 'HIDE' })} /> {L('Hide it', 'يختفي')}</label>
      </div>
      <div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.emailCheck} onChange={(e) => void save({ emailCheck: e.target.checked })} /> {L('Confirm the e-mail with a code', 'تأكيد الإيميل بكود')}</label>
        <p className={`mt-1 text-xs ${data.emailReady ? 'text-emerald-700' : 'text-amber-700'}`}>{data.emailReady ? L('E-mail sending is set up.', 'إرسال الإيميل متظبط.') : L('E-mail sending is not set up yet (needs the company domain + the Resend key on the host).', 'إرسال الإيميل لسه مش متظبط (محتاج دومين الشركة + مفتاح Resend على الاستضافة).')}</p>
      </div>
      <label className="flex items-center gap-2">{L('Password link works for', 'لينك الباسورد شغال لمدة')}<input type="number" min={1} max={30} className={`${input} w-20`} defaultValue={s.linkDays} onBlur={(e) => { const n = Number(e.target.value); if (n && n !== s.linkDays) void save({ linkDays: n }) }} /> {L('day(s)', 'يوم')}</label>
    </section>
  )
}
