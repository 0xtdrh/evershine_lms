'use client'

/** LMS L3: homework rules form (late rule, penalty, handing in again, excuse extension, parents for young children). */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface Policy { late: string; latePenaltyPct: number; resubmit: boolean; maxAttempts: number; excuseExtensionDays: number; parentCanSubmit: boolean; showAnswers?: string; showGrades?: string; gallery?: string }

export const ANSWER_LABEL: Record<string, string> = { NEVER: 'Never', AFTER_SUBMIT: 'Right after handing in', AFTER_DUE: 'After the due date', AFTER_NEXT_SESSION: 'After the next session' }
export const GALLERY_LABEL: Record<string, string> = { OWN: 'Only the student and the family', GROUP: "The student's group", ALL: 'Everyone at TechNova' }
export const GRADE_LABEL: Record<string, string> = { IMMEDIATE: 'As soon as it is graded', AFTER_DUE: 'After the due date', AFTER_NEXT_SESSION: 'After the next session' }

export const LATE_LABEL: Record<string, string> = { ALLOWED: 'Late is fine (not marked)', MARK_LATE: 'Allowed, marked late', CLOSED: 'Closed after the due date' }

export function PolicyForm({ value, onSave, onReset }: { value: Policy; onSave: (p: Policy) => void; onReset?: () => void }) {
  const [p, setP] = useState(value)
  return (
    <div className="space-y-2 text-sm">
      <label className="flex flex-wrap items-center gap-2">After the due date
        <Select value={p.late} onValueChange={(v) => setP({ ...p, late: v })}><SelectTrigger className="h-8 w-60"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(LATE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex items-center gap-2">Late penalty <Input type="number" min={0} max={100} className="h-8 w-20" value={p.latePenaltyPct} onChange={(e) => setP({ ...p, latePenaltyPct: Number(e.target.value) || 0 })} /> %</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={p.resubmit} onChange={(e) => setP({ ...p, resubmit: e.target.checked })} /> May hand in again, up to <Input type="number" min={1} max={10} className="h-8 w-16" value={p.maxAttempts} onChange={(e) => setP({ ...p, maxAttempts: Number(e.target.value) || 1 })} /> tries</label>
      <label className="flex items-center gap-2">Excused absence gives <Input type="number" min={0} max={60} className="h-8 w-16" value={p.excuseExtensionDays} onChange={(e) => setP({ ...p, excuseExtensionDays: Number(e.target.value) || 0 })} /> more days</label>
      <label className="flex flex-wrap items-center gap-2">Students see the correct answers
        <Select value={p.showAnswers ?? 'AFTER_DUE'} onValueChange={(v) => setP({ ...p, showAnswers: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ANSWER_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex flex-wrap items-center gap-2">Students and parents see the grade + feedback
        <Select value={p.showGrades ?? 'IMMEDIATE'} onValueChange={(v) => setP({ ...p, showGrades: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(GRADE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex flex-wrap items-center gap-2">Gallery projects are seen by
        <Select value={p.gallery ?? 'GROUP'} onValueChange={(v) => setP({ ...p, gallery: v })}><SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(GALLERY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={p.parentCanSubmit} onChange={(e) => setP({ ...p, parentCanSubmit: e.target.checked })} /> Parents may hand in for young children (kid-mode age)</label>
      <div className="flex gap-2"><Button size="sm" onClick={() => onSave({ ...p, showAnswers: p.showAnswers ?? 'AFTER_DUE', showGrades: p.showGrades ?? 'IMMEDIATE', gallery: p.gallery ?? 'GROUP' })}>Save</Button>{onReset && <Button size="sm" variant="ghost" onClick={onReset}>Use the default</Button>}</div>
    </div>
  )
}

