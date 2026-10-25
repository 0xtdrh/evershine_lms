'use client'
/**
 * _components.tsx — Shared field components & constants for the admission wizard.
 *
 * WHY separate file: Keeps the 900+ line page.tsx focused on form logic.
 * All presentation primitives and static data live here.
 *
 * DESIGN: Enterprise "navy-gold" palette matching academy branding.
 */

import { Label } from '@/components/ui/label'
import { L } from '@/lib/i18n/client'
import {
  AlertCircle,
  BookOpen,
  User,
  GraduationCap,
  ClipboardList,
  Users,
  Send,
} from 'lucide-react'

/* ── Field Primitives ─────────────────────────────────────────── */

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5 font-medium animate-in fade-in slide-in-from-top-1 duration-200">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
      {message}
    </p>
  )
}

export function FL({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-[13px] font-semibold text-slate-700 tracking-wide">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </Label>
  )
}

export function FRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">{children}</div>
}

export function FGroup({ children, full }: { children: React.ReactNode; full?: boolean }) {
  return (
    <div
      className={`space-y-2 ${full ? 'sm:col-span-2' : ''} rounded-xl p-0.5 transition-all duration-200 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:ring-offset-1 focus-within:ring-offset-white`}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pb-4 mb-3 border-b border-slate-200/80">
      <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-blue-600 to-indigo-600" />
      <h3 className="text-lg font-bold text-slate-900 tracking-tight">{children}</h3>
    </div>
  )
}

/* ── Step Metadata ────────────────────────────────────────────── */

// 2026-10-24: labels follow the screen language (getters, so the arrays stay the same shape)
export const STEP_META = [
  { get label() { return L('Program', 'البرنامج') },    get desc() { return L('Share campus & delivery mode preferences if known', 'الفرع وطريقة الحضور لو تعرفهم') }, icon: BookOpen },
  { get label() { return L('Student', 'الطالب') },      get desc() { return L('Personal identity, contact & residential address', 'بيانات الطالب والتليفون والعنوان') }, icon: User },
  { get label() { return L('Background', 'الدراسة') },  get desc() { return L('Current school, grade & any prior programming experience', 'المدرسة والصف وأي خبرة قبل كده في البرمجة') }, icon: GraduationCap },
  { get label() { return L('Guardian', 'ولي الأمر') },  get desc() { return L('Parent or guardian contact details', 'بيانات ولي الأمر') }, icon: Users },
  { get label() { return L('Review', 'المراجعة') },     get desc() { return L('Confirm your details, accept terms & submit', 'راجع البيانات، وافق على الشروط وابعت') }, icon: Send },
]

/* ── Static Data Constants ────────────────────────────────────── */

export const FATHER_OCCUPATIONS = [
  'Government Service', 'Private Service', 'Business / Self-Employed',
  'Teaching', 'Doctor / Medical', 'Engineer', 'Lawyer',
  'Military / Police', 'Retired', 'Other',
]

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export const RELATIONSHIPS = [
  'Father', 'Mother', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Grandfather',
  'Grandmother', 'Legal Guardian', 'Other',
]

export const PARENT_STATUSES = [
  { value: 'BOTH_ALIVE', get label() { return L('Both parents present', 'الأب والأم موجودين') } },
  { value: 'FATHER_DECEASED', get label() { return L('Father deceased', 'الأب متوفي') } },
  { value: 'MOTHER_DECEASED', get label() { return L('Mother deceased', 'الأم متوفية') } },
  { value: 'BOTH_DECEASED', get label() { return L('Both deceased', 'الاتنين متوفيين') } },
  { value: 'DIVORCED', get label() { return L('Parents divorced', 'الأب والأم منفصلين') } },
]

// WHY no COURSE_FEE_ESTIMATE_MAP: Fee structures are managed by the Super Admin
// at approval time, not hardcoded in the frontend. Hardcoded fees would drift
// from actual institutional pricing and create data integrity issues. The admin
// enters the exact fee amounts during the admission approval workflow.

/**
 * Delivery modes for course enrollment.
 * WHY exported: Used by both the public admission form and the admin admission wizard
 * to let applicants/admins select how the student will attend classes.
 */
export const DELIVERY_MODES = [
  { value: 'PHYSICAL', get label() { return L('🏫 On-Campus (Physical)', '🏫 في الفرع') } },
  { value: 'ONLINE', get label() { return L('💻 Online', '💻 أونلاين') } },
  { value: 'HYBRID', get label() { return L('🔄 Hybrid (On-Campus + Online)', '🔄 الاتنين (فرع + أونلاين)') } },
] as const

export const MARKETING_SOURCES = [
  'Facebook/Instagram', 'TikTok', 'TechNova Website', 'WhatsApp',
  'Family/Friends', 'School', 'Nursery', 'Event/Competition', 'Other'
]

/* ── Admission Rules ───────────────────────────────────────────── */
// 2026-10-24: editable on the Agreements page (AppSetting admission.rules, lib/admissions/rules.ts); the page loads
// them from GET /api/admission-rules and falls back to the defaults.

/** Arabic names for the stored English choices (occupation, relationship, how they heard of us). */
const OPTION_AR: Record<string, string> = {
  'Government Service': 'موظف حكومي', 'Private Service': 'قطاع خاص', 'Business / Self-Employed': 'أعمال حرة',
  Teaching: 'تدريس', 'Doctor / Medical': 'طبيب / مجال طبي', Engineer: 'مهندس', Lawyer: 'محامي',
  'Military / Police': 'جيش / شرطة', Retired: 'على المعاش', Other: 'غير كده',
  Father: 'الأب', Mother: 'الأم', Brother: 'الأخ', Sister: 'الأخت', Uncle: 'العم / الخال', Aunt: 'العمة / الخالة',
  Grandfather: 'الجد', Grandmother: 'الجدة', 'Legal Guardian': 'وصي قانوني',
  'TechNova Website': 'موقع TechNova', 'Family/Friends': 'العيلة / الأصحاب', School: 'المدرسة', Nursery: 'الحضانة',
  'Event/Competition': 'فعالية / مسابقة',
}
/** Label of a stored choice in the screen language (the stored value stays English). */
export const optLabel = (v: string) => L(v, OPTION_AR[v] ?? v)
