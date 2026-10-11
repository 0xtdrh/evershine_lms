'use client'

/** LMS L3: homework rules form (late rule, penalty, handing in again, excuse extension, parents for young children). */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { L } from '@/lib/i18n/client'

export interface Policy { late: string; latePenaltyPct: number; resubmit: boolean; maxAttempts: number; excuseExtensionDays: number; parentCanSubmit: boolean; showAnswers?: string; showGrades?: string; gallery?: string }

export const ANSWER_LABEL: Record<string, string> = { NEVER: 'Never', AFTER_SUBMIT: 'Right after handing in', AFTER_DUE: 'After the due date', AFTER_NEXT_SESSION: 'After the next session' }
const ANSWER_AR: Record<string, string> = { NEVER: 'أبدًا', AFTER_SUBMIT: 'بعد التسليم على طول', AFTER_DUE: 'بعد آخر ميعاد', AFTER_NEXT_SESSION: 'بعد الحصة اللي بعدها' }
export const GALLERY_LABEL: Record<string, string> = { OWN: 'Only the student and the family', GROUP: "The student's group", ALL: 'Everyone at TechNova' }
const GALLERY_AR: Record<string, string> = { OWN: 'الطالب وأهله بس', GROUP: 'جروب الطالب', ALL: 'كل TechNova' }
export const GRADE_LABEL: Record<string, string> = { IMMEDIATE: 'As soon as it is graded', AFTER_DUE: 'After the due date', AFTER_NEXT_SESSION: 'After the next session' }
const GRADE_AR: Record<string, string> = { IMMEDIATE: 'أول ما يتصحّح', AFTER_DUE: 'بعد آخر ميعاد', AFTER_NEXT_SESSION: 'بعد الحصة اللي بعدها' }

export const LATE_LABEL: Record<string, string> = { ALLOWED: 'Late is fine (not marked)', MARK_LATE: 'Allowed, marked late', CLOSED: 'Closed after the due date' }
const LATE_AR: Record<string, string> = { ALLOWED: 'التأخير عادي (من غير علامة)', MARK_LATE: 'مسموح ويتعلّم متأخر', CLOSED: 'مقفول بعد آخر ميعاد' }
export const lateLabel = (k: string) => L(LATE_LABEL[k] ?? k, LATE_AR[k] ?? k)

export function PolicyForm({ value, onSave, onReset }: { value: Policy; onSave: (p: Policy) => void; onReset?: () => void }) {
  const [p, setP] = useState(value)
  return (
    <div className="space-y-2 text-sm">
      <label className="flex flex-wrap items-center gap-2">{L('After the due date', 'بعد آخر ميعاد')}
        <Select value={p.late} onValueChange={(v) => setP({ ...p, late: v })}><SelectTrigger className="h-8 w-60"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(LATE_LABEL).map((k) => <SelectItem key={k} value={k}>{lateLabel(k)}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex items-center gap-2">{L('Late penalty', 'خصم التأخير')} <Input type="number" min={0} max={100} className="h-8 w-20" value={p.latePenaltyPct} onChange={(e) => setP({ ...p, latePenaltyPct: Number(e.target.value) || 0 })} /> %</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={p.resubmit} onChange={(e) => setP({ ...p, resubmit: e.target.checked })} /> {L('May hand in again, up to', 'يقدر يسلّم تاني، لحد')} <Input type="number" min={1} max={10} className="h-8 w-16" value={p.maxAttempts} onChange={(e) => setP({ ...p, maxAttempts: Number(e.target.value) || 1 })} /> {L('tries', 'محاولات')}</label>
      <label className="flex items-center gap-2">{L('Excused absence gives', 'الغياب بعذر بيدّي')} <Input type="number" min={0} max={60} className="h-8 w-16" value={p.excuseExtensionDays} onChange={(e) => setP({ ...p, excuseExtensionDays: Number(e.target.value) || 0 })} /> {L('more days', 'أيام زيادة')}</label>
      <label className="flex flex-wrap items-center gap-2">{L('Students see the correct answers', 'الطلبة يشوفوا الإجابات الصح')}
        <Select value={p.showAnswers ?? 'AFTER_DUE'} onValueChange={(v) => setP({ ...p, showAnswers: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(ANSWER_LABEL).map((k) => <SelectItem key={k} value={k}>{L(ANSWER_LABEL[k], ANSWER_AR[k])}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex flex-wrap items-center gap-2">{L('Students and parents see the grade + feedback', 'الطلبة وأولياء الأمور يشوفوا الدرجة والتعليق')}
        <Select value={p.showGrades ?? 'IMMEDIATE'} onValueChange={(v) => setP({ ...p, showGrades: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(GRADE_LABEL).map((k) => <SelectItem key={k} value={k}>{L(GRADE_LABEL[k], GRADE_AR[k])}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex flex-wrap items-center gap-2">{L('Gallery projects are seen by', 'مشاريع المعرض بيشوفها')}
        <Select value={p.gallery ?? 'GROUP'} onValueChange={(v) => setP({ ...p, gallery: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(GALLERY_LABEL).map((k) => <SelectItem key={k} value={k}>{L(GALLERY_LABEL[k], GALLERY_AR[k])}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={p.parentCanSubmit} onChange={(e) => setP({ ...p, parentCanSubmit: e.target.checked })} /> {L('Parents may hand in for young children (kid-mode age)', 'ولي الأمر يقدر يسلّم بدل الطفل الصغير (سن وضع الأطفال)')}</label>
      <div className="flex gap-2"><Button size="sm" onClick={() => onSave({ ...p, showAnswers: p.showAnswers ?? 'AFTER_DUE', showGrades: p.showGrades ?? 'IMMEDIATE', gallery: p.gallery ?? 'GROUP' })}>{L('Save', 'حفظ')}</Button>{onReset && <Button size="sm" variant="ghost" onClick={onReset}>{L('Use the default', 'استخدم الافتراضي')}</Button>}</div>
    </div>
  )
}

