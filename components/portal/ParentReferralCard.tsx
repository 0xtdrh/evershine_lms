'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Award, Copy, Gift, MessageCircle } from 'lucide-react'

interface Summary {
  code: string | null; rewardEnabled: boolean; rewardAmount: number; welcomeEnabled: boolean
  ambassador: boolean; ambassadorAt: number; rewardedCount: number; totalReward: number
  friends: { id: string; name: string; status: string; joinedAt: string; reward: number }[]
}

export function referralShareText(code: string, origin: string) {
  return `I recommend TechNova for STEM, robotics and programming courses 🤖✨\nRegister with my referral code ${code}:\n${origin}/admissions/apply`
}

/** Phase D: the parent's referral code, share on WhatsApp, friends who joined, ambassador badge. */
export function ParentReferralCard({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery({ queryKey: ['my-referral'], queryFn: () => fetchApi<Summary>('/api/referrals/mine') })
  if (!data?.code) return null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const text = referralShareText(data.code, origin)
  const copy = async () => { try { await navigator.clipboard.writeText(text); notify.success('Copied') } catch { notify.error('Copy failed') } }
  return (
    <Card className="border-indigo-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Gift className="h-5 w-5 text-indigo-600" /> Invite a friend{data.ambassador && <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800"><Award className="h-3.5 w-3.5" /> TechNova Ambassador</span>}</CardTitle>
        <CardDescription>
          Share your code. {data.rewardEnabled ? `When your friend's child pays the first invoice, you get ${data.rewardAmount} EGP in your child's wallet.` : 'Thank you for recommending us!'}
          {data.welcomeEnabled ? ' Your friend gets a welcome discount too.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50 px-3 py-1.5 font-mono text-lg font-bold tracking-wider text-indigo-800">{data.code}</span>
          <Button asChild size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700">
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /> Send on WhatsApp</a>
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={copy}><Copy className="h-4 w-4" /> Copy</Button>
        </div>
        {!compact && data.friends.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-semibold uppercase text-slate-500">Friends who joined ({data.friends.length}) · rewards {data.totalReward} EGP</p>
            {data.friends.map((f) => (
              <div key={f.id} className="flex justify-between rounded border border-slate-100 px-2 py-1">
                <span>{f.name}</span>
                <span className="text-xs text-slate-500">{f.status === 'REWARDED' ? (f.reward ? `🎁 ${f.reward} EGP` : 'joined ✓') : 'waiting for the first payment'}</span>
              </div>
            ))}
            {!data.ambassador && <p className="text-xs text-slate-400">{Math.max(0, data.ambassadorAt - data.rewardedCount)} more to become a TechNova Ambassador.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
