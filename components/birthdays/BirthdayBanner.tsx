'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'

interface Me { self: { name: string; turns: number; studentId?: string } | null; children: { studentId: string; name: string; turns: number }[] }

/** Phase C: big "Happy birthday" banner on the portal / dashboard on the day. */
export function BirthdayBanner() {
  const { data } = useQuery({ queryKey: ['birthday-me'], queryFn: () => fetchApi<Me>('/api/birthdays/me'), staleTime: 60 * 60 * 1000 })
  if (!data || (!data.self && !data.children.length)) return null
  const lines = [
    ...(data.self ? [{ text: `Happy birthday, ${data.self.name}! 🎂`, sub: 'Everyone at TechNova wishes you a wonderful year full of joy, learning and new inventions.', card: data.self.studentId }] : []),
    ...data.children.map((c) => ({ text: `Happy birthday to ${c.name}! 🎉`, sub: `${c.name} turns ${c.turns} today. All of us at TechNova wish ${c.name} a wonderful year.`, card: c.studentId })),
  ]
  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-pink-200 bg-gradient-to-r from-pink-50 via-amber-50 to-indigo-50 p-5">
      <div className="pointer-events-none absolute -right-2 -top-4 select-none text-7xl opacity-30">🎈🎁</div>
      {lines.map((l, i) => (
        <div key={i} className={i ? 'mt-4' : ''}>
          <p className="text-2xl font-black text-pink-700 sm:text-3xl">{l.text}</p>
          <p className="mt-1 text-sm text-slate-700">{l.sub}</p>
          {l.card && (
            <a href={`/birthday-card/${l.card}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block rounded-full bg-pink-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-pink-700">
              Open the birthday certificate
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
