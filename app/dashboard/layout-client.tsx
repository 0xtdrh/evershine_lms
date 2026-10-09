'use client'

import { useAppStore } from '@/lib/store'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { signOut, useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { DEFAULT_PERMISSION_MATRIX, type AcademicResource, type Action } from '@/lib/rbac'
import { motion, AnimatePresence } from 'framer-motion'
import { notificationPanel, pulseRing, sidebarSlide } from '@/lib/animations'
import { PageTransition } from '@/components/shared/page-transition'
import {
  LayoutDashboard,
  Gift,
  Settings2,
  Power,
  FileSignature,
  ClipboardX,
  Star,
  Cake,
  BellRing,
  Users,
  GraduationCap,
  CreditCard,
  ClipboardCheck,
  FileText,
  LogOut,
  Menu,
  X,
  BookOpen,
  BarChart2,
  Megaphone,
  CalendarDays,
  Building,
  Settings,
  ChevronRight,
  CalendarClock,
  RefreshCcw,
  PhoneCall,
  CalendarOff,
  AlertOctagon,
  HelpCircle,
  Banknote,
  Bell,
  UserCheck,
  Wallet,
  ClipboardList,
  ShieldCheck,
  KeyRound,
  Inbox,
  LineChart,
  Target,
  Check,
  MessageSquare,
  Info,
  AlertCircle,
  Archive,
  CheckCheck,
  UploadCloud,
  Award,
  SlidersHorizontal,
  Palette,
  Sparkles,
  DatabaseBackup,
  Hourglass,
  BadgePercent,
  Undo2,
} from 'lucide-react'
import { AcademyLogo } from '@/components/AcademyLogo'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { MobileNav } from '@/components/layout/MobileNav'
import { isAcademicEnginePrimary } from '@/lib/academic/config'
import { CompulsoryFeedbackBlocker } from '@/components/student/CompulsoryFeedbackBlocker'
import { GuardianFeedbackModal } from '@/components/feedback/GuardianFeedbackModal'
import { FeeOverdueModal } from '@/components/student/FeeOverdueModal'
import { getNotificationModuleForNavLabel, type NotificationCounts } from '@/lib/notifications/module-map'
import { BirthdayCelebration, useBirthdayToday } from '@/components/birthdays/BirthdayCelebration'
import { AgreementsGate } from '@/components/agreements/AgreementsGate'
import { I18nProvider, LanguageSwitch } from '@/lib/i18n/client'

// ─── Role-gated nav items ─────────────────────────────────────────────────────
interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles?: string[]
  legacy?: boolean
  /** Shown only if the role has ANY of these permissions (Permissions page aware). */
  perm?: Array<[AcademicResource, Action]>
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard',       href: '/dashboard',              icon: LayoutDashboard },
  { name: 'Admin Workspace', href: '/dashboard/admin',        icon: ShieldCheck,     roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Permissions',     href: '/dashboard/admin/permissions',      icon: ShieldCheck,     roles: ['SUPER_ADMIN'] },
  { name: 'Notifications',   href: '/dashboard/admin/notifications',    icon: BellRing,        roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Settings Centre', href: '/dashboard/settings-center',        icon: Settings2,       roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY'] },
  { name: 'Platform',        href: '/dashboard/admin/platform',         icon: Power,           roles: ['SUPER_ADMIN', 'ADMIN'], perm: [['platform_settings', 'read']] },
  { name: 'Agreements',      href: '/dashboard/admin/agreements',       icon: FileSignature,   roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['agreements', 'read']] },
  { name: 'Role Assumptions', href: '/dashboard/admin/role-assumptions', icon: KeyRound,    roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Credential Management', href: '/dashboard/admin/credential-management', icon: KeyRound, roles: ['SUPER_ADMIN'] },
  { name: 'Backups',         href: '/dashboard/admin/backups',          icon: DatabaseBackup,  roles: ['SUPER_ADMIN'] },
  { name: 'Admissions',      href: '/dashboard/admissions',   icon: ClipboardCheck,  roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'MARKETING'], perm: [['admissions', 'read']] },
  { name: 'Landing Leads',   href: '/dashboard/leads',        icon: Inbox,           roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'MARKETING'], perm: [['admissions', 'read']] },
  { name: 'Students',        href: '/dashboard/students',     icon: Users,           roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['students', 'read']] },
  { name: 'Waiting List',    href: '/dashboard/waiting-list', icon: Hourglass,       roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['waiting_list', 'read']] },
  { name: 'Staff Directory',  href: '/dashboard/teachers',     icon: Users,           roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['teachers', 'read']] },
  { name: 'Fees',            href: '/dashboard/fees',         icon: CreditCard,      roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STUDENT', 'PARENT', 'GUARDIAN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['fees', 'read']] },
  { name: 'Accounting Hub',   href: '/dashboard/accountant',    icon: Wallet,          roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'], perm: [['fee_collection', 'read'], ['expenses', 'read'], ['profit_loss', 'read']] },
  { name: 'Fee Collection',  href: '/dashboard/accountant/fees', icon: CreditCard,     roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['fee_collection', 'read']] },
  { name: 'Discounts',       href: '/dashboard/discounts',    icon: BadgePercent,    roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['discounts', 'read'], ['discount_approvals', 'read'], ['discount_types', 'read']] },
  { name: 'Refunds',         href: '/dashboard/refunds',      icon: Undo2,           roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['refunds', 'read']] },
  { name: 'Expense Ledger',  href: '/dashboard/accountant/expenses', icon: Wallet,     roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'], perm: [['expenses', 'read']] },
  { name: 'Financial Reports', href: '/dashboard/accountant/reports', icon: BarChart2, roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'], perm: [['financial_reports', 'read'], ['profit_loss', 'read']] },
  { name: 'Leaves',          href: '/dashboard/leaves',       icon: CalendarClock,   roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STUDENT', 'BRANCH_MANAGER'], perm: [['leaves', 'create'], ['leaves', 'approve']] },
  { name: 'Complaints',      href: '/dashboard/complaints',   icon: AlertOctagon,    roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'STUDENT', 'PARENT', 'GUARDIAN'] },
  { name: 'Referrals',       href: '/dashboard/referrals',    icon: Gift,            roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING'], perm: [['referrals', 'read']] },
  { name: 'Academic Queries',href: '/dashboard/queries',      icon: HelpCircle,      roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT'] },
  { name: 'Staff Salaries',  href: '/dashboard/salaries',     icon: Banknote,        roles: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'], perm: [['salaries', 'read'], ['salaries', 'approve']] },
  { name: 'Attendance', href: '/dashboard/attendance/sections', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['attendance', 'read']] },
  { name: 'Attendance Report', href: '/dashboard/reports/attendance', icon: BarChart2, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Staff Attendance', href: '/dashboard/teachers/attendance', icon: UserCheck, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Biometric Import', href: '/dashboard/admin/attendance-import', icon: UploadCloud, roles: ['SUPER_ADMIN', 'ADMIN'], perm: [['attendance_import', 'create']] },
  { name: 'Class Attendance (Legacy)', href: '/dashboard/attendance/legacy', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'ADMIN'], legacy: true },
  { name: 'Exams',           href: '/dashboard/exams',        icon: BookOpen,        roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'BRANCH_MANAGER', 'SECRETARY'] },
  // Teachers use the canonical Academic Engine result workflow below. Keep
  // the legacy page available for administrators and backwards-compatible
  // links, but do not expose two competing Results entries to teachers.
  { name: 'Results',         href: '/dashboard/results',      icon: BarChart2,       roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Announcements',   href: '/dashboard/announcements',icon: Megaphone,       roles: ['SUPER_ADMIN', 'ADMIN', 'GUARDIAN', 'PARENT', 'STUDENT', 'BRANCH_MANAGER', 'SECRETARY', 'MARKETING'] },
  { name: 'Calendar',        href: '/dashboard/calendar',     icon: CalendarDays },
  { name: 'My Courses',      href: '/dashboard/enrollment',   icon: BookOpen,        roles: ['STUDENT'] },
  { name: 'Timetable',       href: '/dashboard/timetable',    icon: CalendarClock,   roles: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Documents',       href: '/dashboard/documents',    icon: FileText,        roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Certificate Designer', href: '/dashboard/certificate-templates', icon: Palette, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Certificate Reveal',   href: '/dashboard/certificate-reveal',    icon: Sparkles, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Campuses',        href: '/dashboard/campuses',     icon: Building,        roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Classes (Legacy)', href: '/dashboard/classes',      icon: GraduationCap,   roles: ['SUPER_ADMIN', 'ADMIN'], legacy: true },
  { name: 'Academic Engine', href: '/dashboard/academic',     icon: ClipboardList,   roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Grading Weights', href: '/dashboard/grading-config', icon: SlidersHorizontal, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Course Structure', href: '/dashboard/course-config', icon: GraduationCap, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Groups', href: '/dashboard/groups', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'], perm: [['class_sections', 'read']] },
  { name: 'Wallet & Top-ups', href: '/dashboard/wallet', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['wallet', 'read']] },
  { name: 'Renewals', href: '/dashboard/renewals', icon: RefreshCcw, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['renewals', 'read']] },
  { name: 'Follow-ups', href: '/dashboard/follow-ups', icon: PhoneCall, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['contact_logs', 'read']] },
  { name: 'Holidays', href: '/dashboard/holidays', icon: CalendarOff, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['holidays', 'read']] },
  { name: 'Absence Excuses', href: '/dashboard/absence-excuses', icon: ClipboardX, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'TEACHER'], perm: [['absence_excuses', 'read']] },
  { name: 'Ratings', href: '/dashboard/ratings', icon: Star, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['ratings', 'read']] },
  { name: 'Birthdays', href: '/dashboard/birthdays', icon: Cake, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'TEACHER'], perm: [['birthdays', 'read']] },
  { name: 'Groups Schedule', href: '/dashboard/schedule', icon: CalendarClock, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'], perm: [['class_sections', 'read']] },
  { name: 'Groups Financials', href: '/dashboard/reports/groups-financials', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Absence Requests', href: '/dashboard/absence-requests', icon: AlertOctagon, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY'] },
  { name: 'Substitute Reconciliation', href: '/dashboard/reports/substitute-reconciliation', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
  { name: 'My Schedule', href: '/dashboard/teacher/my-schedule', icon: CalendarClock, roles: ['TEACHER'] },
  { name: 'My Calendar', href: '/dashboard/schedule', icon: CalendarDays, roles: ['TEACHER'] },
  { name: 'My Substitutions', href: '/dashboard/teacher/my-substitutions', icon: ClipboardList, roles: ['TEACHER'] },
  { name: 'Promotions',      href: '/dashboard/promotions',   icon: GraduationCap,   roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'Report Cards',    href: '/dashboard/report-cards', icon: FileText,        roles: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] },
  { name: 'My Children',     href: '/dashboard/my-children',  icon: Users,           roles: ['PARENT', 'GUARDIAN'] },
  { name: 'Certificates',    href: '/dashboard/certificates', icon: Award,           roles: ['STUDENT', 'PARENT', 'GUARDIAN'] },
  { name: 'Settings',        href: '/dashboard/settings',     icon: Settings },
]

const TEACHER_NAV_ITEMS: NavItem[] = [
  { name: 'My Students',        href: '/dashboard/teacher/students',          icon: Users },
  { name: 'Student Attendance', href: '/dashboard/teacher/attendance',        icon: ClipboardCheck },
  { name: 'Import Attendance',  href: '/dashboard/teacher/attendance-import', icon: UploadCloud },
  { name: 'My Announcements',   href: '/dashboard/teacher/announcements',     icon: Megaphone },
  { name: 'Tasks & Marks',      href: '/dashboard/teacher/tasks',             icon: ClipboardList },
  { name: 'Daily Scores',       href: '/dashboard/teacher/daily-scores',      icon: Target },
  { name: 'Level Results',      href: '/dashboard/teacher/level-results',     icon: Award },
  { name: 'Grade Entry',        href: '/dashboard/teacher/grade-entry',       icon: GraduationCap },
  { name: 'Student Targets',    href: '/dashboard/teacher/targets',           icon: Target },
  { name: 'Exam Results',       href: '/dashboard/teacher/results',           icon: BarChart2 },
  { name: 'Monthly Monitoring', href: '/dashboard/teacher/monthly-monitoring', icon: LineChart },
  { name: 'Student Leaves',     href: '/dashboard/teacher/leaves',            icon: UserCheck },
  { name: 'HR & Salary',        href: '/dashboard/teacher/hr',                icon: Wallet },
]

type EffectivePermissions = Record<string, Action[]>

/**
 * Role list first (unchanged behaviour), then the Permissions page:
 * - a revoked permission hides the item;
 * - an item listed for the role but whose permission the role never had is
 *   hidden too (it only led to a "Forbidden" page);
 * - a permission GRANTED by an override (not in the base matrix) shows the
 *   item even if the role is not in `roles`.
 * Until /api/me/permissions has loaded, only the role list is used.
 */
function isNavItemVisible(item: NavItem, role: string, effective?: EffectivePermissions): boolean {
  const listed = !item.roles || item.roles.length === 0 || item.roles.includes(role)
  if (!item.perm || !effective) return listed

  const base = DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX]
  return item.perm.some(([resource, action]) => {
    if (!effective[resource]?.includes(action)) return false
    if (listed) return true
    const inBase = base?.[resource]?.includes(action) ?? false
    return !inBase
  })
}

/** Language provider around the dashboard; defaults come from Platform settings. */
export default function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const { data: platform } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => fetchApi<{ language: { staff: 'en' | 'ar'; portal: 'en' | 'ar' }; modules: Record<string, boolean> }>('/api/platform/settings'),
    enabled: !!session?.user,
    staleTime: 5 * 60 * 1000,
  })
  return <I18nProvider defaults={platform?.language}><DashboardShell>{children}</DashboardShell></I18nProvider>
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const { sidebarOpen, setSidebarOpen, setUser } = useAppStore()
  const role = (session?.user?.role as string) ?? ''
  const { active: birthdayToday } = useBirthdayToday()

  useEffect(() => {
    if (status === 'authenticated' && !role) {
      console.warn(
        '[DASHBOARD] Role is empty in session — RBAC nav filtering will hide all role-gated items. ' +
        'Check NEXTAUTH_URL, NEXTAUTH_SECRET, and whether trustHost: true is set in auth config.',
        'session user:', session?.user,
      )
    }
  }, [status, role, session])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    } else if (session?.user) {
      setUser({
        id: session.user.id,
        email: session.user.email!,
        role: role,
        name: session.user.name ?? '',
        campusId: session.user.campusId as string | null,
      })
    }
  }, [session, status, router, setUser, role])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname, setSidebarOpen])

  const { data: countsData } = useQuery({
    queryKey: ['notification-counts'],
    queryFn: () => fetchApi<NotificationCounts>('/api/notifications/counts'),
    refetchInterval: 30000,
    enabled: status === 'authenticated',
  })

  const { data: myPermissions } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ role: string; permissions: EffectivePermissions }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: status === 'authenticated' && !!role,
  })

  const getBadgeCount = (itemName: string) => {
    if (!countsData?.modules) return 0
    const key = getNotificationModuleForNavLabel(itemName)
    return key ? (countsData.modules[key] ?? 0) : 0
  }

  useEffect(() => {
    const badgeApi = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }

    if (!badgeApi.setAppBadge || !badgeApi.clearAppBadge) return

    const updateBadge = countsData?.total && countsData.total > 0
      ? badgeApi.setAppBadge(countsData.total)
      : badgeApi.clearAppBadge()

    void updateBadge.catch(() => {})
  }, [countsData?.total])

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading your workspace...</p>
        </div>
      </div>
    )
  }

  const enginePrimary = isAcademicEnginePrimary()
  const visibleNav = NAV_ITEMS.filter(
    (item) => isNavItemVisible(item, role, myPermissions?.permissions) && (!enginePrimary || !item.legacy)
  )
  const isTeacher   = role === 'TEACHER'

  const getRoleBadge = (r: string) => {
    const map: Record<string, { label: string; className: string }> = {
      SUPER_ADMIN: { label: 'Super Admin', className: 'bg-red-100 text-red-700' },
      ADMIN: { label: 'Admin', className: 'bg-blue-100 text-blue-700' },
      TEACHER: { label: 'Teacher', className: 'bg-green-100 text-green-700' },
      STUDENT: { label: 'Student', className: 'bg-purple-100 text-purple-700' },
      PARENT: { label: 'Parent', className: 'bg-orange-100 text-orange-700' },
      ACCOUNTANT: { label: 'Account Manager', className: 'bg-teal-100 text-teal-700' },
      GUARDIAN: { label: 'Guardian', className: 'bg-yellow-100 text-yellow-700' },
    }
    return map[r] ?? { label: r, className: 'bg-gray-100 text-gray-700' }
  }

  const roleBadge = getRoleBadge(role)

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.aside
          variants={sidebarSlide}
          initial={sidebarOpen ? "animate" : "initial"}
          animate={sidebarOpen ? "animate" : "initial"}
          className="fixed inset-y-0 left-0 bg-white border-r border-slate-200 w-64 z-[60] flex flex-col md:relative md:translate-x-0 md:!transform-none shadow-soft-lg md:shadow-none"
        >
          <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100 flex-shrink-0">
            <Link href="/dashboard" className="flex items-center gap-3">
              <AcademyLogo variant="compact" className="h-10" />
            </Link>
            <button className="md:hidden p-1 rounded-md hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-3">
            <div className="space-y-0.5">
              {visibleNav.map((item) => {
                const active = isActive(item.href)
                const badgeCount = getBadgeCount(item.name)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold border-l-[3px] border-blue-600 pl-[9px]'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? 'text-blue-600' : ''}`} />
                      {item.name}
                    </div>
                    <div className="flex items-center gap-2">
                      {badgeCount > 0 && (
                        <span className="min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                      <ChevronRight className={`w-3.5 h-3.5 transition-all duration-200 ${active ? 'opacity-70 text-blue-500' : 'opacity-0 group-hover:opacity-40'}`} />
                    </div>
                  </Link>
                )
              })}

              {isTeacher && (
                <>
                  <div className="pt-3 pb-1 px-3">
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Teacher Hub</p>
                  </div>
                  {TEACHER_NAV_ITEMS.map((item) => {
                    const active = isActive(item.href)
                    const badgeCount = getBadgeCount(item.name)
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                          active
                            ? 'bg-emerald-50 text-emerald-700 font-semibold border-l-[3px] border-emerald-600 pl-[9px]'
                            : 'text-gray-600 hover:bg-emerald-50/50 hover:text-emerald-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <item.icon className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? 'text-emerald-600' : ''}`} />
                          {item.name}
                        </div>
                        <div className="flex items-center gap-2">
                          {badgeCount > 0 && (
                            <span className="min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1">
                              {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                          )}
                          <ChevronRight className={`w-3.5 h-3.5 transition-all duration-200 ${active ? 'opacity-70 text-emerald-500' : 'opacity-0 group-hover:opacity-40'}`} />
                        </div>
                      </Link>
                    )
                  })}
                </>
              )}
            </div>
          </nav>

          <div className="flex-shrink-0 border-t border-gray-100 p-3 space-y-2">
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-gray-50/80">
              <div className="w-9 h-9 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm overflow-hidden">
                {session?.user?.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.profilePicture}
                    alt={session.user.name ?? 'Profile'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                    {session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? '?'}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {session?.user?.name ?? session?.user?.email}
                </p>
                <span className={`inline-flex text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${roleBadge.className}`}>
                  {roleBadge.label}
                </span>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 rounded-lg hover:bg-red-50 hover:text-red-600 transition-all duration-200 group"
            >
              <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              Sign out
            </button>
          </div>
        </motion.aside>
      </AnimatePresence>

      <main className="flex-1 flex flex-col min-w-0">
        <header className={`relative z-50 h-16 border-b flex items-center px-4 md:px-6 gap-4 flex-shrink-0 shadow-[0_1px_3px_0_rgba(0,0,0,0.04)] ${birthdayToday ? 'keep-light border-pink-200 bg-gradient-to-r from-pink-100 via-amber-50 to-pink-100' : 'border-gray-200/80 bg-white/95 backdrop-blur-sm'}`}>
          <button
            className="md:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>

          <div className="flex-1 min-w-0">
            <Breadcrumbs pathname={pathname} />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitch />
            <ThemeToggle />
            <NotificationBell />
            <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-gray-200">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-800 leading-tight">{birthdayToday && <span className="mr-1" title="Happy birthday!">🎂</span>}{session?.user?.name ?? session?.user?.email}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${roleBadge.className}`}>
                  {roleBadge.label}
                </span>
              </div>
              <div className="w-9 h-9 rounded-full flex-shrink-0 ring-2 ring-gray-100 shadow-sm overflow-hidden">
                {session?.user?.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.profilePicture}
                    alt={session.user.name ?? 'Profile'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                    {session?.user?.name?.[0] ?? '?'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 pb-24 sm:p-6 md:pb-6 relative bg-slate-50/50" style={{ paddingBottom: 'clamp(6rem, calc(6rem + env(safe-area-inset-bottom, 0px)), 8rem)' }}>
          <PageTransition>
            <BirthdayCelebration />
            <AgreementsGate />
            {role === 'STUDENT' && (
              <>
                <CompulsoryFeedbackBlocker />
                <FeeOverdueModal />
              </>
            )}
            {(role === 'PARENT' || role === 'GUARDIAN') && (
              <>
                <GuardianFeedbackModal />
                <FeeOverdueModal />
              </>
            )}
            {children}
          </PageTransition>
        </div>
        <div className="md:hidden">
          <MobileNav pathname={pathname} role={role} />
        </div>
      </main>
    </div>
  )
}

interface Notif { id: string; title: string; message: string; type: string; isRead: boolean; relatedId?: string | null; createdAt: string }

function NotificationBell() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'inbox' | 'archive'>('inbox')
  const ref = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchPaginatedApi<Notif>('/api/notifications?limit=20'),
    refetchInterval: 30000,
  })

  const { data: countsData } = useQuery({
    queryKey: ['notification-counts'],
    queryFn: () => fetchApi<NotificationCounts>('/api/notifications/counts'),
    refetchInterval: 30000,
  })

  const notifications = data?.data ?? []
  const unreadNotifications = notifications.filter(n => !n.isRead)
  const readNotifications = notifications.filter(n => n.isRead)
  const unreadCount = countsData?.total ?? unreadNotifications.length

  const displayedNotifications = activeTab === 'inbox' ? unreadNotifications : readNotifications

  const markAllMutation = useMutation({
    mutationFn: () => fetchApi('/api/notifications', { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notification-counts'] })
    },
  })

  const markOneMutation = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/notifications/${id}`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notification-counts'] })
    },
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const getCategoryBadge = (type: string) => {
    const map: Record<string, { label: string; className: string }> = {
      RESULT_PUBLISHED: { label: 'Academics', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      DATE_SHEET_PUBLISHED: { label: 'Exams', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      DAILY_SCORE_POSTED: { label: 'Daily Scores', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      TARGET_ASSIGNED: { label: 'Targets', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      ATTENDANCE_ALERT: { label: 'Attendance', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      TIMETABLE_CHANGE: { label: 'Timetable', className: 'bg-purple-50 text-purple-700 border-purple-100' },
      TIMETABLE_REQUEST: { label: 'Timetable', className: 'bg-purple-50 text-purple-700 border-purple-100' },
      TIMETABLE_UPDATE: { label: 'Timetable', className: 'bg-purple-50 text-purple-700 border-purple-100' },
      LEAVE_SUBMITTED:  { label: 'Leaves', className: 'bg-blue-50 text-blue-700 border-blue-100' },
      LEAVE_APPROVED:   { label: 'Leaves', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      LEAVE_REJECTED:   { label: 'Leaves', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      ADMISSION_APPROVED: { label: 'Admissions', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      ADMISSION_DECLINED: { label: 'Admissions', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      QUERY_RECEIVED:   { label: 'Academic Query', className: 'bg-blue-50 text-blue-700 border-blue-100' },
      QUERY_ANSWERED:   { label: 'Academic Query', className: 'bg-blue-50 text-blue-700 border-blue-100' },
      FEE_INVOICE_GENERATED: { label: 'Finance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      FEE_OVERDUE:      { label: 'Finance', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      FEE_REMINDER:     { label: 'Finance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      FEE_STATUS_UPDATE: { label: 'Finance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      FEE_UPDATE:       { label: 'Finance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      PROOF_RECEIVED:   { label: 'Payment Proof', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      PROOF_APPROVED:   { label: 'Payment Proof', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      PROOF_REJECTED:   { label: 'Payment Proof', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      COMPLAINT_SUBMITTED: { label: 'Complaints', className: 'bg-blue-50 text-blue-700 border-blue-100' },
      COMPLAINT_RESOLVED: { label: 'Complaints', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      ANNOUNCEMENT: { label: 'Announcement', className: 'bg-sky-50 text-sky-700 border-sky-100' },
      WALLET:         { label: 'Wallet', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      WALLET_PAYMENT: { label: 'Wallet', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      LOW_BALANCE:    { label: 'Wallet', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      ATTENDANCE_ABSENT: { label: 'Attendance', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      ATTENDANCE_LATE:   { label: 'Attendance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      EXCUSE_DECIDED:    { label: 'Excuse', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      EXCUSE_PENDING:    { label: 'Excuse', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      INVOICE_NEW:       { label: 'Finance', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      SESSION_CANCELLED: { label: 'Schedule', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      SESSION_SUBSTITUTE: { label: 'Schedule', className: 'bg-purple-50 text-purple-700 border-purple-100' },
      HOLIDAY:           { label: 'Schedule', className: 'bg-purple-50 text-purple-700 border-purple-100' },
      CERTIFICATE_ISSUED: { label: 'Certificate', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
      REPORT_READY:      { label: 'Report', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      PERFECT_ATTENDANCE: { label: 'Well done', className: 'bg-amber-50 text-amber-700 border-amber-100' },
      FEEDBACK_REQUEST:  { label: 'Your opinion', className: 'bg-sky-50 text-sky-700 border-sky-100' },
      BIRTHDAY:          { label: 'Birthday', className: 'bg-pink-50 text-pink-700 border-pink-100' },
      BIRTHDAY_STAFF:    { label: 'Birthdays', className: 'bg-pink-50 text-pink-700 border-pink-100' },
      CONSECUTIVE_ABSENCE: { label: 'Follow-up', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      LOW_RATING:        { label: 'Follow-up', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      MORNING_SUMMARY:   { label: 'Summary', className: 'bg-slate-50 text-slate-700 border-slate-100' },
      RENEWAL_REQUEST:   { label: 'Renewal', className: 'bg-sky-50 text-sky-700 border-sky-100' },
      COMPLAINT_NEW:     { label: 'Complaints', className: 'bg-blue-50 text-blue-700 border-blue-100' },
      COMPLAINT_UPDATE:  { label: 'Your message', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
      COMPLAINT_ESCALATED: { label: 'Escalated', className: 'bg-rose-50 text-rose-700 border-rose-100' },
      REFERRAL_UPDATE:   { label: 'Referral', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    }
    const config = map[type] ?? { label: 'General', className: 'bg-slate-50 text-slate-700 border-slate-100' }
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${config.className}`}>
        {config.label}
      </span>
    )
  }

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'LEAVE_APPROVED':
      case 'ADMISSION_APPROVED':
      case 'COMPLAINT_RESOLVED':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 flex-shrink-0">
            <Check className="h-4.5 w-4.5" strokeWidth={3} />
          </span>
        )
      case 'LEAVE_REJECTED':
      case 'ADMISSION_DECLINED':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-600 flex-shrink-0">
            <X className="h-4.5 w-4.5" strokeWidth={3} />
          </span>
        )
      case 'QUERY_RECEIVED':
      case 'QUERY_ANSWERED':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 flex-shrink-0">
            <MessageSquare className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
      case 'FEE_INVOICE_GENERATED':
      case 'FEE_OVERDUE':
      case 'FEE_REMINDER':
      case 'FEE_STATUS_UPDATE':
      case 'FEE_UPDATE':
      case 'PROOF_RECEIVED':
      case 'PROOF_APPROVED':
      case 'PROOF_REJECTED':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-600 flex-shrink-0">
            <AlertCircle className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
      case 'RESULT_PUBLISHED':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 flex-shrink-0">
            <GraduationCap className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
      case 'ATTENDANCE_ALERT':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-600 flex-shrink-0">
            <AlertOctagon className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
      case 'TIMETABLE_CHANGE':
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 text-purple-600 flex-shrink-0">
            <CalendarClock className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
      default:
        return (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-600 flex-shrink-0">
            <Info className="h-4.5 w-4.5" strokeWidth={2} />
          </span>
        )
    }
  }

  const formatTimeAgo = (dateStr: string) => {
    try {
      const now = new Date()
      const past = new Date(dateStr)
      const diffMs = now.getTime() - past.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays}d ago`
      return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-gray-600" />
        {unreadCount > 0 && (
          <motion.span
            variants={pulseRing}
            animate="animate"
            className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center leading-none"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={notificationPanel}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute right-0 top-full mt-2 w-96 sm:w-[440px] bg-white border border-slate-200 rounded-2xl shadow-xl z-[9999] overflow-hidden"
          >
            <div className="flex flex-col border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                <span className="font-bold text-sm text-slate-800">Notifications</span>
                {unreadNotifications.length > 0 && (
                  <button
                    onClick={() => markAllMutation.mutate()}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition-colors hover:underline"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="flex gap-4 px-4 border-t border-slate-100/50 pt-1">
                <button
                  onClick={() => setActiveTab('inbox')}
                  className={`py-2 text-xs font-semibold border-b-2 transition-all relative ${
                    activeTab === 'inbox'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Inbox className="w-3.5 h-3.5" />
                    Inbox
                    {unreadNotifications.length > 0 && (
                      <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                        {unreadNotifications.length}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('archive')}
                  className={`py-2 text-xs font-semibold border-b-2 transition-all relative ${
                    activeTab === 'archive'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5" />
                    Archive
                    {readNotifications.length > 0 && (
                      <span className="bg-slate-200 text-slate-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                        {readNotifications.length}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            </div>

            <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
              {displayedNotifications.length === 0 ? (
                <div className="py-12 text-center px-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400 mx-auto mb-3">
                    {activeTab === 'inbox' ? <Inbox className="w-5 h-5" /> : <Archive className="w-5 h-5" />}
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    {activeTab === 'inbox' ? 'Your inbox is clear' : 'No archived alerts'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {activeTab === 'inbox'
                      ? 'You are all caught up. New messages will appear here.'
                      : 'Read notifications will be archived here.'}
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {displayedNotifications.map(n => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      key={n.id}
                      className={`flex gap-3 px-4 py-3.5 transition-colors border-l-[3px] ${
                        n.isRead
                          ? 'border-transparent bg-white hover:bg-slate-50/50'
                          : 'border-indigo-600 bg-indigo-50/10 hover:bg-indigo-50/20'
                      }`}
                    >
                      {getNotifIcon(n.type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {getCategoryBadge(n.type)}
                              {!n.isRead && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 flex-shrink-0 animate-pulse" />
                              )}
                            </div>
                            <p className={`text-[13px] leading-snug break-words mt-0.5 ${!n.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                              {n.title}
                            </p>
                          </div>
                          <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap flex-shrink-0 mt-0.5">
                            {formatTimeAgo(n.createdAt)}
                          </span>
                        </div>
                        <p className={`text-xs mt-1.5 leading-relaxed whitespace-pre-wrap break-words ${!n.isRead ? 'text-slate-700 font-normal' : 'text-slate-500 font-normal'}`}>
                          {n.message}
                        </p>
                        {n.type === 'WALLET_PAYMENT' && n.relatedId && (
                          <a href={`/receipts/${n.relatedId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline font-semibold mt-1.5 mr-3 inline-block">
                            Open receipt
                          </a>
                        )}
                        {!n.isRead && (
                          <button
                            onClick={() => markOneMutation.mutate(n.id)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold mt-2.5 inline-flex items-center gap-1 transition-colors hover:underline"
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
