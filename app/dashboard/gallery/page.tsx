'use client'

/** LMS L3 batch 2: projects gallery — approved student projects (first name only), emoji reactions only. Bilingual. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink, Images, Loader2 } from 'lucide-react'

interface Item {
  id: string; firstName: string; titleEn: string | null; titleAr: string | null; course: string; level: string
  image: string | null; video: string | null; link: string | null; code: string | null; text: string | null
  reactions: Record<string, number>; myReactions: string[]; own: boolean
}
const EMOJIS = ['👏', '❤️', '🤩', '🔥', '⭐']

export default function GalleryPage() {
  const { t, pick, dir } = useI18n()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['gallery'], queryFn: () => fetchApi<Item[]>('/api/gallery') })
  const react = useMutation({
    mutationFn: (b: { submissionId: string; emoji: string }) => fetchApi('/api/gallery/react', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gallery'] }),
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-5" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Images className="h-7 w-7 text-amber-500" /> {t('hw.gallery')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('gal.subtitle')}</p>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        : error ? <p className="text-sm text-slate-500">{(error as Error).message.includes('switched on') ? t('les.off') : (error as Error).message}</p>
        : !data?.length ? <p className="text-sm text-slate-500">{t('gal.none')}</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((i) => (
              <Card key={i.id} className={i.own ? 'border-amber-300' : ''}>
                <CardContent className="space-y-2 pt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.image ? <img src={i.image} alt={pick(i.titleEn, i.titleAr) || 'project'} className="h-48 w-full rounded-lg object-cover" />
                    : i.video ? <video src={i.video} controls controlsList="nodownload" className="h-48 w-full rounded-lg bg-black" />
                      : i.code ? <pre dir="ltr" className="h-48 overflow-hidden rounded-lg bg-slate-900 p-2 font-mono text-[10px] text-slate-100">{i.code}</pre>
                        : <div className="flex h-48 items-center justify-center rounded-lg bg-amber-50 text-4xl">🚀</div>}
                  <p className="font-semibold text-slate-800">{pick(i.titleEn, i.titleAr) || t('hw.homework')}</p>
                  <p className="text-xs text-slate-500">{i.firstName} · {i.course} {i.level}</p>
                  {i.text && <p className="line-clamp-3 text-xs text-slate-600">{i.text}</p>}
                  {i.link && <a href={i.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 underline"><ExternalLink className="h-3 w-3" /> {t('gal.open')}</a>}
                  <div className="flex flex-wrap gap-1">
                    {EMOJIS.map((e) => (
                      <button key={e} type="button" onClick={() => react.mutate({ submissionId: i.id, emoji: e })}
                        className={`rounded-full border px-2 py-0.5 text-sm ${i.myReactions.includes(e) ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
                        {e} {i.reactions[e] || ''}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </div>
  )
}
