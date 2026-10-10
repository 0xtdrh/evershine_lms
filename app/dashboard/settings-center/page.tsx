'use client'

/** Settings centre: every setting of TechNova, grouped, one click away (shown only where the user has access). */

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { checkPermission } from '@/lib/rbac'
import { Card, CardContent } from '@/components/ui/card'
import { Settings2 } from 'lucide-react'

type Perm = Parameters<typeof checkPermission>[1]
interface Item { title: string; titleAr: string; desc: string; href: string; perm?: [Perm, Parameters<typeof checkPermission>[2]]; superOnly?: boolean }

const GROUPS: { name: string; items: Item[] }[] = [
  {
    name: 'Platform',
    items: [
      { title: 'Modules & language', titleAr: 'تشغيل الأنظمة واللغة', desc: 'Switch LMS, passport, gamification… on/off; default language', href: '/dashboard/admin/platform', perm: ['platform_settings', 'read'] },
      { title: 'Agreements', titleAr: 'الموافقات', desc: 'Rules, privacy, photos — what parents accept', href: '/dashboard/admin/agreements', perm: ['agreements', 'read'] },
      { title: 'Notifications', titleAr: 'الإشعارات', desc: 'Turn each notification on or off', href: '/dashboard/admin/notifications', perm: ['notification_settings', 'read'] },
      { title: 'Permissions', titleAr: 'الصلاحيات', desc: 'What each role can do', href: '/dashboard/admin/permissions', superOnly: true },
    ],
  },
  {
    name: 'Money',
    items: [
      { title: 'Payments', titleAr: 'الدفع', desc: 'Accounts shown to parents, methods, due days, receipts', href: '/dashboard/admin/finance-settings', perm: ['finance_settings', 'read'] },
      { title: 'Wallet', titleAr: 'المحفظة', desc: 'Minimum top-up, withdrawals, online fee, promos', href: '/dashboard/wallet', perm: ['wallet', 'read'] },
      { title: 'Discounts', titleAr: 'الخصومات', desc: 'Discount types, rules, early renewal, birthday', href: '/dashboard/discounts', perm: ['discounts', 'read'] },
      { title: 'Referrals', titleAr: 'الإحالة', desc: 'Reward, welcome discount, ambassador', href: '/dashboard/referrals', perm: ['referrals', 'read'] },
    ],
  },
  {
    name: 'Students & sessions',
    items: [
      { title: 'Absence excuses', titleAr: 'أعذار الغياب', desc: 'Automatic or approval, days allowed after the session', href: '/dashboard/absence-excuses', perm: ['absence_excuses', 'read'] },
      { title: 'Holidays', titleAr: 'الإجازات', desc: 'Branch / company days off', href: '/dashboard/holidays', perm: ['holidays', 'read'] },
      { title: 'Renewals', titleAr: 'التجديد', desc: 'When parents are asked "continuing?"', href: '/dashboard/renewals', perm: ['renewals', 'read'] },
      { title: 'Complaints', titleAr: 'الشكاوى', desc: 'Reply deadline, auto-close', href: '/dashboard/complaints', perm: ['complaints', 'export'] },
      { title: 'Curriculum', titleAr: 'المنهج', desc: 'Lessons for every level', href: '/dashboard/curriculum', perm: ['curriculum', 'read'] },
      { title: 'Rubrics', titleAr: 'جداول التصحيح', desc: 'Reusable grading tables for homework', href: '/dashboard/admin/rubrics', perm: ['curriculum', 'read'] },
      { title: 'LMS', titleAr: 'المنصة التعليمية', desc: 'How lessons open, watermark, kid mode', href: '/dashboard/admin/lms', perm: ['curriculum', 'read'] },
    ],
  },
  {
    name: 'System',
    items: [
      { title: 'Backups', titleAr: 'النسخ الاحتياطي', desc: 'Daily backups and downloads', href: '/dashboard/admin/backups', superOnly: true },
      { title: 'Login locks', titleAr: 'قفل الدخول', desc: 'Unlock accounts after wrong passwords', href: '/dashboard/admin/login-locks', superOnly: true },
    ],
  },
]

export default function SettingsCenterPage() {
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const visible = (i: Item) => (i.superOnly ? role === 'SUPER_ADMIN' : !i.perm || checkPermission(role, i.perm[0], i.perm[1]))
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Settings2 className="h-7 w-7 text-indigo-600" /> Settings centre</h1>
        <p className="mt-1 text-sm text-slate-500">Every TechNova setting in one place.</p>
      </div>
      {GROUPS.map((g) => {
        const items = g.items.filter(visible)
        if (!items.length) return null
        return (
          <div key={g.name} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-slate-500">{g.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i) => (
                <Link key={i.href} href={i.href}>
                  <Card className="h-full transition hover:shadow-md"><CardContent className="pt-4">
                    <p className="font-semibold text-slate-800">{i.title} <span className="text-xs font-normal text-slate-400" dir="rtl">· {i.titleAr}</span></p>
                    <p className="text-xs text-slate-500">{i.desc}</p>
                  </CardContent></Card>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
