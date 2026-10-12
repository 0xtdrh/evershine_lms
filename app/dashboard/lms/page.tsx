'use client'

/** LMS hub for staff — every LMS page in one place, grouped, with what is waiting (bilingual). */

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { checkPermission } from '@/lib/rbac'
import { useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import { LmsAnalytics } from '@/components/lms/LmsAnalytics'
import { Card, CardContent } from '@/components/ui/card'
import { Award, BarChart3, BookOpen, CheckCircle2, FileText, ClipboardCheck, ClipboardList, GraduationCap, Images, Library, ListChecks, Power, Settings2, Table2 } from 'lucide-react'

type Perm = Parameters<typeof checkPermission>[1]
interface Tile { href: string; en: string; ar: string; descEn: string; descAr: string; icon: React.ComponentType<{ className?: string }>; perm?: [Perm, Parameters<typeof checkPermission>[2]]; count?: number; countEn?: string; countAr?: string }

export default function LmsHubPage() {
  const { data: session } = useSession()
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const role = session?.user?.role ?? ''
  const allowed = !!role && checkPermission(role, 'curriculum', 'read')
  const { data: n } = useQuery({ queryKey: ['lms-hub'], queryFn: () => fetchApi<{ toGrade: number; quizReview: number; inReview: number; myPerformance?: boolean }>('/api/lms/hub'), enabled: allowed, refetchInterval: 60_000 })
  if (!role) return null
  if (!allowed) return <AccessDenied title="LMS" message="You don't have access to the LMS." />
  const teacher = role === 'TEACHER'
  const groups: { en: string; ar: string; tiles: Tile[] }[] = [
    {
      en: 'Content', ar: 'المحتوى', tiles: [
        { href: '/dashboard/curriculum', en: 'Curriculum', ar: 'المنهج', descEn: 'Lessons of every level, versions, review', descAr: 'دروس كل مستوى، النسخ، المراجعة', icon: BookOpen, perm: ['curriculum', 'read'], count: n?.inReview, countEn: 'waiting for approval', countAr: 'مستني موافقة' },
        { href: '/dashboard/question-bank', en: 'Question bank', ar: 'بنك الأسئلة', descEn: 'Questions per course / level for quizzes', descAr: 'أسئلة لكل كورس ومستوى للكويزات', icon: Library, perm: ['curriculum', 'update'] },
        { href: '/dashboard/admin/rubrics', en: 'Rubrics', ar: 'جداول التصحيح', descEn: 'Reusable grading tables for homework', descAr: 'جداول تصحيح جاهزة للواجبات', icon: Table2, perm: ['curriculum', 'update'] },
      ],
    },
    {
      en: 'Teaching', ar: 'التدريس', tiles: [
        { href: teacher ? '/dashboard/teacher/attendance' : '/dashboard/attendance/sections', en: 'Lesson plan & attendance', ar: 'خطة الحصة والحضور', descEn: 'Open / lock lessons, group notes — inside the attendance screen', descAr: 'فتح وقفل الدروس وملاحظات الجروب — جوه شاشة الحضور', icon: ClipboardCheck },
        { href: '/dashboard/profile-approvals', en: 'Profile approvals', ar: 'موافقات البروفايل', descEn: 'Thank-you notes and student project uploads', descAr: 'رسايل الشكر ورفع مشاريع الطلبة', icon: CheckCircle2 },
        { href: '/dashboard/session-reports', en: 'Session reports', ar: 'تقارير الحصص', descEn: 'Report after each session: stars, phrases, what is missing', descAr: 'تقرير بعد كل حصة: نجوم، جمل جاهزة، والحاجات الناقصة', icon: FileText, perm: ['session_reports', 'read'] },
        ...(teacher && n?.myPerformance ? [{ href: '/dashboard/teacher-performance', en: 'My performance', ar: 'أدائي', descEn: 'Attendance, ratings, renewals, grading of your groups', descAr: 'الحضور والتقييمات والتجديد والتصحيح في جروباتك', icon: Award }] : []),
      ],
    },
    {
      en: 'Grading & results', ar: 'التصحيح والنتائج', tiles: [
        { href: '/dashboard/assignments', en: 'Grade homework', ar: 'تصحيح الواجبات', descEn: 'Hand-ins, rubrics, code, voice notes', descAr: 'التسليمات، الـ Rubrics، الكود، الرسائل الصوتية', icon: ClipboardList, perm: ['curriculum', 'read'], count: n?.toGrade, countEn: 'waiting to be graded', countAr: 'مستني تصحيح' },
        { href: '/dashboard/quizzes', en: 'Quizzes & exams', ar: 'الكويزات والامتحانات', descEn: 'Open the final exam, scores, paper exams, analysis', descAr: 'فتح الامتحان النهائي، الدرجات، الورقي، التحليل', icon: ListChecks, perm: ['curriculum', 'read'], count: n?.quizReview, countEn: 'code answers to review', countAr: 'إجابات كود للمراجعة' },
        { href: '/dashboard/gallery', en: 'Projects gallery', ar: 'معرض المشاريع', descEn: 'Projects approved by instructors', descAr: 'المشاريع اللي المدربين اختاروها', icon: Images, perm: ['curriculum', 'read'] },
        { href: teacher ? '/dashboard/teacher/level-results' : '/dashboard/results', en: 'Level results', ar: 'نتائج المستوى', descEn: 'Homework / task / project / MCQ from the LMS', descAr: 'درجات الواجبات والكويزات والمشروع من المنصة', icon: BarChart3 },
      ],
    },
    {
      en: 'Settings', ar: 'الإعدادات', tiles: [
        { href: '/dashboard/admin/lms', en: 'LMS settings', ar: 'إعدادات المنصة التعليمية', descEn: 'How lessons open, homework rules, kid mode', descAr: 'إزاي الدروس بتتفتح، قواعد الواجبات، وضع الأطفال', icon: Settings2, perm: ['curriculum', 'approve'] },
        { href: '/dashboard/admin/platform', en: 'Switch the LMS on / off', ar: 'تشغيل / إيقاف المنصة', descEn: 'Students see lessons only while it is on', descAr: 'الطلبة بيشوفوا الدروس بس وهي شغالة', icon: Power, perm: ['platform_settings', 'read'] },
      ],
    },
  ]
  const visible = (t: Tile) => !t.perm || checkPermission(role, t.perm[0], t.perm[1])
  return (
    <div className="space-y-6" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><GraduationCap className="h-7 w-7 text-indigo-600" /> {ar ? 'المنصة التعليمية' : 'LMS'}</h1>
        <p className="mt-1 text-sm text-slate-500">{ar ? 'كل حاجة ليها علاقة بالمنهج والتدريس والتصحيح في مكان واحد.' : 'Everything about curriculum, teaching and grading in one place.'}</p>
      </div>
      {groups.map((g) => {
        const tiles = g.tiles.filter(visible)
        if (!tiles.length) return null
        return (
          <div key={g.en} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-slate-500">{ar ? g.ar : g.en}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tiles.map((t) => (
                <Link key={t.href + t.en} href={t.href}>
                  <Card className="h-full transition hover:shadow-md">
                    <CardContent className="flex items-start gap-3 pt-4">
                      <t.icon className="mt-0.5 h-6 w-6 shrink-0 text-indigo-600" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2 font-semibold text-slate-800">{ar ? t.ar : t.en}
                          {!!t.count && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{t.count}</span>}
                        </span>
                        <span className="block text-xs text-slate-500">{ar ? t.descAr : t.descEn}</span>
                        {!!t.count && <span className="mt-1 block text-xs font-medium text-rose-600">{t.count} {ar ? t.countAr : t.countEn}</span>}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
      {['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'].includes(role) && <LmsAnalytics />}
    </div>
  )
}
