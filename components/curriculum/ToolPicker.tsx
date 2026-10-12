'use client'

/** L5: choose a tool from the list (or a site the admin added), paste the project link, write what to do. */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TOOL_CATALOG, TOOL_CATEGORIES, toolForUrl, type ExtraSite } from '@/lib/lms/tools'

const area = 'min-h-[80px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm'

export function ToolPicker({ data, onChange }: { data: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { data: settings } = useQuery({ queryKey: ['lms-tools'], queryFn: () => fetchApi<{ extra: ExtraSite[] }>('/api/lms/tools'), staleTime: 60_000 })
  const extra = settings?.extra ?? []
  const url = (data.url as string) ?? ''
  const match = url ? toolForUrl(url, extra) : null
  const options = [...TOOL_CATALOG.map((t) => ({ id: t.id, name: ar ? t.nameAr : t.nameEn, cat: t.category, example: t.example, mode: t.mode })), ...extra.map((e) => ({ id: `site:${e.host}`, name: (ar && e.nameAr) || e.nameEn, cat: 'OTHER', example: `https://${e.host}/`, mode: e.mode }))]
  const chosen = options.find((o) => o.id === match?.id)
  return (
    <div className="space-y-2">
      <Select value={chosen?.id ?? ''} onValueChange={(id) => { const o = options.find((x) => x.id === id); if (o) onChange({ url: o.example }) }}>
        <SelectTrigger className="w-80"><SelectValue placeholder={L('Choose a tool', 'اختار أداة')} /></SelectTrigger>
        <SelectContent>
          {Object.entries(TOOL_CATEGORIES).map(([cat, label]) => {
            const items = options.filter((o) => o.cat === cat)
            if (!items.length) return null
            return [
              <div key={`h-${cat}`} className="px-2 pt-2 text-xs font-semibold text-slate-400">{ar ? label.ar : label.en}</div>,
              ...items.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} {o.mode === 'NEW_TAB' ? '↗' : ''}</SelectItem>),
            ]
          })}
        </SelectContent>
      </Select>
      <Input placeholder={L('Link of the project / page (https://…)', 'لينك المشروع / الصفحة (https://…)')} value={url} onChange={(e) => onChange({ url: e.target.value })} />
      {url && (match
        ? <p className={`text-xs ${match.mode === 'INLINE' ? 'text-emerald-700' : 'text-amber-700'}`}>{match.mode === 'INLINE' ? L(`${match.nameEn}: opens inside the lesson.`, `${match.nameAr}: بيتفتح جوه الدرس.`) : L(`${match.nameEn}: the site does not allow being shown inside another site — students open it in a new tab and hand in their project link.`, `${match.nameAr}: الموقع مابيسمحش يتفتح جوه موقع تاني — الطلبة بيفتحوه في تاب جديد ويسلّموا لينك مشروعهم.`)}</p>
        : <p className="text-xs text-rose-600">{L('This site is not in the tools list. An admin can add it in LMS settings → Tools.', 'الموقع ده مش في قايمة الأدوات. الأدمن يقدر يضيفه من إعدادات المنصة ← الأدوات.')}</p>)}
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea className={area} placeholder={L('What to do (English, optional)', 'المطلوب (إنجليزي، اختياري)')} value={(data.instructionsEn as string) ?? ''} onChange={(e) => onChange({ instructionsEn: e.target.value })} />
        <textarea className={area} dir="rtl" placeholder="المطلوب (عربي، اختياري)" value={(data.instructionsAr as string) ?? ''} onChange={(e) => onChange({ instructionsAr: e.target.value })} />
      </div>
      {match?.mode !== 'NEW_TAB' && <label className="flex items-center gap-2 text-xs">{L('Height (px)', 'الارتفاع (px)')} <Input type="number" className="h-8 w-24" value={Number(data.height) || 600} onChange={(e) => onChange({ height: Number(e.target.value) || 600 })} /></label>}
    </div>
  )
}
