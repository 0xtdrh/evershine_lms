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

export const STEP_META = [
  { label: 'Program',   desc: 'Share campus & delivery mode preferences if known',      icon: BookOpen },
  { label: 'Student',   desc: 'Personal identity, contact & residential address',       icon: User },
  { label: 'Background', desc: 'Current school, grade & any prior programming experience', icon: GraduationCap },
  { label: 'Guardian',  desc: 'Parent or guardian contact details',         icon: Users },
  { label: 'Review',    desc: 'Confirm your details, accept terms & submit',            icon: Send },
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
  { value: 'BOTH_ALIVE', label: 'Both parents present' },
  { value: 'FATHER_DECEASED', label: 'Father deceased' },
  { value: 'MOTHER_DECEASED', label: 'Mother deceased' },
  { value: 'BOTH_DECEASED', label: 'Both deceased' },
  { value: 'DIVORCED', label: 'Parents divorced' },
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
  { value: 'PHYSICAL', label: '🏫 On-Campus (Physical)' },
  { value: 'ONLINE', label: '💻 Online' },
  { value: 'HYBRID', label: '🔄 Hybrid (On-Campus + Online)' },
] as const

export const MARKETING_SOURCES = [
  'Facebook/Instagram', 'TikTok', 'TechNova Website', 'WhatsApp',
  'Family/Friends', 'School', 'Nursery', 'Event/Competition', 'Other'
]

/* ── Admission Rules ───────────────────────────────────────────── */

export const ADMISSION_RULES = [
  'Fee once deposited is neither refundable nor adjustable in any case.',
  'Session timings are subject to the availability of the trainers and can be amended if required.',
  'Parents are welcome to contact the branch regularly to discuss the student\'s progress.',
  'Please pay your monthly dues within the mentioned dates.',
  'Any damage caused by the student to TechNova equipment will be charged accordingly.',
  'TechNova is relieved of responsibility (legal, etc.) in case of any injury, damage, or loss which is beyond its control.',
  'TechNova will not, in any case, be responsible for any loss suffered by a student.',
  'Registration is mandatory for every student every year.',
  'Decisions of the administration will be final, in any case.',
  'I acknowledge that my enrollment will remain active for the complete session unless an official withdrawal application is submitted and approved. If I wish to leave, I must submit the application at least 14 calendar days before the end of the intended final month and clear all outstanding dues.',
]
