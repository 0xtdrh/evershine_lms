'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { getNotificationModuleForNavLabel, type NotificationCounts } from '@/lib/notifications/module-map'
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n/client'

interface NavItem {
  href: string
  /** English name — also the key for notification badges */
  label: string
  ar: string
  icon: React.ComponentType<{ className?: string }>
}

// Mobile bottom nav — the 5 most used pages per role (5-A, 2026-10-16: no old template screens; Arabic names).
const home: NavItem = { href: '/dashboard', label: 'Home', ar: 'الرئيسية', icon: LayoutDashboard }
const settings: NavItem = { href: '/dashboard/settings', label: 'Settings', ar: 'الإعدادات', icon: Settings }
const students: NavItem = { href: '/dashboard/students', label: 'Students', ar: 'الطلبة', icon: Users }
const groups: NavItem = { href: '/dashboard/groups', label: 'Groups', ar: 'المجموعات', icon: UsersRound }
const collection: NavItem = { href: '/dashboard/accountant/fees', label: 'Fee Collection', ar: 'التحصيل', icon: CreditCard }
const portal: NavItem[] = [
  home,
  { href: '/dashboard/my-children', label: 'My Children', ar: 'أبنائي', icon: Users },
  { href: '/dashboard/fees', label: 'Fees', ar: 'المصروفات', icon: CreditCard },
  { href: '/dashboard/passport', label: 'My Passport', ar: 'الجواز', icon: BookOpen },
  settings,
]
const ROLE_NAV_MAP: Record<string, NavItem[]> = {
  STUDENT: [
    home,
    { href: '/dashboard/learning', label: 'My Learning', ar: 'تعلّمي', icon: BookOpen },
    { href: '/dashboard/fees', label: 'Fees', ar: 'المصروفات', icon: CreditCard },
    { href: '/dashboard/passport', label: 'My Passport', ar: 'جوازي', icon: ShieldCheck },
    settings,
  ],
  PARENT: portal,
  GUARDIAN: portal,
  TEACHER: [
    home,
    { href: '/dashboard/schedule', label: 'My Calendar', ar: 'جدولي', icon: CalendarClock },
    { href: '/dashboard/teacher/attendance', label: 'Student Attendance', ar: 'الحضور', icon: ClipboardCheck },
    { href: '/dashboard/lms', label: 'LMS', ar: 'المنصة', icon: BookOpen },
    settings,
  ],
  SUPER_ADMIN: [home, students, groups, collection, { href: '/dashboard/settings-center', label: 'Settings Centre', ar: 'الإعدادات', icon: Settings }],
  ADMIN: [home, students, groups, collection, { href: '/dashboard/settings-center', label: 'Settings Centre', ar: 'الإعدادات', icon: Settings }],
  BRANCH_MANAGER: [home, students, groups, collection, { href: '/dashboard/schedule', label: 'Groups Schedule', ar: 'الجدول', icon: CalendarClock }],
  SECRETARY: [home, students, groups, { href: '/dashboard/attendance/sections', label: 'Attendance', ar: 'الحضور', icon: ClipboardCheck }, collection],
  ACCOUNTANT: [
    home, collection,
    { href: '/dashboard/wallet', label: 'Wallet & Top-ups', ar: 'المحفظة', icon: Wallet },
    { href: '/dashboard/accountant/expenses', label: 'Expense Ledger', ar: 'المصروفات', icon: BookOpen },
    settings,
  ],
  MARKETING: [home, { href: '/dashboard/admissions', label: 'Admissions', ar: 'التسجيل', icon: Users }, settings],
}

const defaultNav: NavItem[] = [home, settings]

export function MobileNav({ pathname, role }: { pathname: string; role: string }) {
  const navItems = ROLE_NAV_MAP[role] ?? defaultNav
  const { locale } = useI18n()

  const { data: countsData } = useQuery({
    queryKey: ['notification-counts'],
    queryFn: () => fetchApi<NotificationCounts>('/api/notifications/counts'),
    refetchInterval: 30000,
  })

  const getBadgeCount = (itemLabel: string) => {
    if (!countsData?.modules) return 0
    const key = getNotificationModuleForNavLabel(itemLabel)
    return key ? (countsData.modules[key] ?? 0) : 0
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white shadow-xl md:hidden">
      <div className="mx-auto flex max-w-4xl justify-between px-4 py-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          const badgeCount = getBadgeCount(item.label)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-[11px] transition-colors ${
                active ? 'text-primary-600' : 'text-slate-500 hover:text-slate-900'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <div className="relative">
                <Icon className={`h-5 w-5 ${active ? 'text-primary-600' : 'text-slate-500'}`} />
                {badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[8px] font-extrabold min-w-[14px] h-[14px] rounded-full flex items-center justify-center px-0.5 leading-none">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </div>
              <span>{locale === 'ar' ? item.ar : item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
