'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AccessDenied } from '@/components/AccessDenied'
import { notify } from '@/lib/notify'
import { Scale, Loader2 } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { L, useI18n } from '@/lib/i18n/client'
import { campusLabel } from '@/lib/places/label'

type FeePolicy = {
  id: string
  campusId?: string | null
  batchId?: string | null
  isActive?: boolean
  graceDays: number
  penaltyType: string
  penaltyValue: number
  maxPenalty: number | null
  allowedLeavesPerMonth: number
  leavePenaltyAmount: number | string
  allowedAbsencesPerMonth: number
  absencePenaltyAmount: number | string
  campus?: { name: string } | null
  batch?: { name: string } | null
}

type TeacherPolicy = {
  id: string
  campusId?: string | null
  isActive?: boolean
  lateThreshold: number
  penaltyType: string
  penaltyValue: number
  repeatMultiplier: number | null
  allowedLeavesPerMonth: number
  leavePenaltyAmount: number | string
  lateGraceMinutes: number
  freeLatePasses: number
  campus?: { name: string } | null
}

export default function PoliciesPage() {
  useI18n() // re-render on a language switch
  const { data: session, status } = useSession()
  const qc = useQueryClient()
  const role = session?.user?.role
  const allowed = role === 'SUPER_ADMIN' || role === 'ADMIN'

  const [feeForm, setFeeForm] = useState({
    campusId: '',
    batchId: '',
    graceDays: 7,
    penaltyType: 'FIXED' as 'FIXED' | 'PERCENTAGE',
    penaltyValue: 500,
    maxPenalty: '',
    // Leave penalty configuration (enforced on leave approval)
    allowedLeavesPerMonth: 1,
    leavePenaltyAmount: 200,
    allowedAbsencesPerMonth: 3,
    absencePenaltyAmount: 200,
  })

  const [teacherForm, setTeacherForm] = useState({
    campusId: '',
    lateThreshold: 3,
    penaltyType: 'FIXED' as 'FIXED' | 'PERCENTAGE',
    penaltyValue: 200,
    repeatMultiplier: '2',
    // Leave penalty configuration (enforced on leave approval)
    allowedLeavesPerMonth: 1,
    leavePenaltyAmount: 500,
    lateGraceMinutes: 25,
    freeLatePasses: 0,
  })
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null)
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null)

  const { data: feePolicies, isLoading: loadingFee } = useQuery({
    queryKey: ['fee-policies'],
    queryFn: () => fetchApi<FeePolicy[]>('/api/fee-penalties'),
    enabled: allowed,
  })

  const { data: teacherPolicies, isLoading: loadingTeacher } = useQuery({
    queryKey: ['teacher-policies'],
    queryFn: () => fetchApi<TeacherPolicy[]>('/api/teacher-penalties'),
    enabled: allowed,
  })

  const { data: campuses } = useQuery({
    queryKey: ['campuses-policies'],
    queryFn: () => fetchApi<Array<{ id: string; name: string }>>('/api/campuses'),
    enabled: allowed,
  })

  const { data: batches } = useQuery({
    queryKey: ['batches-policies', feeForm.campusId],
    queryFn: () => fetchApi<Array<{ id: string; name: string }>>(`/api/batches?campusId=${feeForm.campusId}`),
    enabled: allowed && !!feeForm.campusId,
  })

  const createFee = useMutation({
    mutationFn: () =>
      fetchApi(editingFeeId ? `/api/fee-penalties/${editingFeeId}` : '/api/fee-penalties', {
        method: editingFeeId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          campusId: feeForm.campusId || null,
          batchId: feeForm.batchId || null,
          graceDays: feeForm.graceDays,
          penaltyType: feeForm.penaltyType,
          penaltyValue: feeForm.penaltyValue,
          maxPenalty: feeForm.maxPenalty ? Number(feeForm.maxPenalty) : null,
          allowedLeavesPerMonth: feeForm.allowedLeavesPerMonth,
          leavePenaltyAmount: feeForm.leavePenaltyAmount,
          allowedAbsencesPerMonth: feeForm.allowedAbsencesPerMonth,
          absencePenaltyAmount: feeForm.absencePenaltyAmount,
        }),
      }),
    onSuccess: () => {
      notify.success(editingFeeId ? 'Fee penalty policy updated' : 'Fee penalty policy created')
      setEditingFeeId(null)
      qc.invalidateQueries({ queryKey: ['fee-policies'] })
    },
    onError: (e: Error) => notify.error(e.message),
  })

  const deactivateFee = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/fee-penalties/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      }),
    onSuccess: () => {
      notify.success(L('Fee policy deactivated', 'السياسة اتوقفت'))
      qc.invalidateQueries({ queryKey: ['fee-policies'] })
    },
    onError: (e: Error) => notify.error(e.message),
  })

  const deactivateTeacher = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/teacher-penalties/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      }),
    onSuccess: () => {
      notify.success(L('Teacher policy deactivated', 'سياسة المدربين اتوقفت'))
      qc.invalidateQueries({ queryKey: ['teacher-policies'] })
    },
    onError: (e: Error) => notify.error(e.message),
  })

  const createTeacher = useMutation({
    mutationFn: () =>
      fetchApi(editingTeacherId ? `/api/teacher-penalties/${editingTeacherId}` : '/api/teacher-penalties', {
        method: editingTeacherId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          campusId: teacherForm.campusId || null,
          lateThreshold: teacherForm.lateThreshold,
          penaltyType: teacherForm.penaltyType,
          penaltyValue: teacherForm.penaltyValue,
          repeatMultiplier: teacherForm.repeatMultiplier
            ? Number(teacherForm.repeatMultiplier)
            : null,
          allowedLeavesPerMonth: teacherForm.allowedLeavesPerMonth,
          leavePenaltyAmount: teacherForm.leavePenaltyAmount,
          lateGraceMinutes: teacherForm.lateGraceMinutes,
          freeLatePasses: teacherForm.freeLatePasses,
        }),
      }),
    onSuccess: () => {
      notify.success(editingTeacherId ? 'Teacher lateness policy updated' : 'Teacher lateness policy created')
      setEditingTeacherId(null)
      qc.invalidateQueries({ queryKey: ['teacher-policies'] })
    },
    onError: (e: Error) => notify.error(e.message),
  })

  if (status === 'loading') return null
  if (!allowed) {
    return (
      <AccessDenied
        title={L('Penalty policies', 'سياسات الغرامات')}
        message="Administrators configure fee and teacher lateness policies here."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale className="w-7 h-7 text-amber-600" />
          {L('Penalty Policies', 'سياسات الغرامات')}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {L('Configure late-payment and leave rules.', 'قواعد التأخير في الدفع والإجازات.')}
        </p>
      </div>

      <Tabs defaultValue="fees">
        <TabsList>
          <TabsTrigger value="fees">{L('Fee late penalties', 'غرامات تأخير الدفع')}</TabsTrigger>
          <TabsTrigger value="teachers">{L('Teacher lateness', 'تأخير المدربين')}</TabsTrigger>
        </TabsList>

        <TabsContent value="fees" className="mt-4">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{L('New fee policy', 'سياسة جديدة')}</CardTitle>
                <CardDescription>
                  {L('Leave the branch empty for the global default. Cron:', 'سيب الفرع فاضي للافتراضي. المهمة:')} <code className="text-xs">/api/cron/fee-penalties</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>{L('Campus (optional)', 'الفرع (اختياري)')}</Label>
                  <Select
                    value={feeForm.campusId || 'global'}
                    onValueChange={(v) =>
                      setFeeForm({ ...feeForm, campusId: v === 'global' ? '' : v, batchId: '' })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">{L('All campuses', 'كل الفروع')}</SelectItem>
                      {(campuses ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{L('Grace days after due date', 'أيام سماح بعد الميعاد')}</Label><Input type="number" value={feeForm.graceDays} onChange={(e) => setFeeForm({ ...feeForm, graceDays: Number(e.target.value) })} /></div>
                <div>
                  <Label>{L('Penalty type', 'نوع الغرامة')}</Label>
                  <Select value={feeForm.penaltyType} onValueChange={(v) => setFeeForm({ ...feeForm, penaltyType: v as 'FIXED' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">{L('Fixed (EGP)', 'ثابتة (ج.م)')}</SelectItem>
                      <SelectItem value="PERCENTAGE">{L('Percentage of balance', 'نسبة من المتبقي')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{L('Penalty value', 'قيمة الغرامة')}</Label><Input type="number" value={feeForm.penaltyValue} onChange={(e) => setFeeForm({ ...feeForm, penaltyValue: Number(e.target.value) })} /></div>
                <div><Label>{L('Max penalty cap (optional)', 'أقصى غرامة (اختياري)')}</Label><Input value={feeForm.maxPenalty} onChange={(e) => setFeeForm({ ...feeForm, maxPenalty: e.target.value })} placeholder={L('e.g. 5000', 'مثلاً 5000')} /></div>
                <div className="border-t border-indigo-100 pt-3 mt-1">
                  {/* Student absence fines hidden (owner, 2026-10-02): lib/penalties/assessments.ts STUDENT_ABSENCE_PENALTIES_ENABLED */}
                  <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2 mt-3">{L('Leave reference (no student charge)', 'مرجع الإجازات (من غير غرامة على الطالب)')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-indigo-700">{L('Allowed Leaves/Month', 'إجازات مسموحة / شهر')}</Label>
                      <Input type="number" min={0} value={feeForm.allowedLeavesPerMonth}
                        onChange={(e) => setFeeForm({ ...feeForm, allowedLeavesPerMonth: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-indigo-700">{L('Leave Penalty (EGP)', 'غرامة الإجازة (ج.م)')}</Label>
                      <Input type="number" min={0} value={feeForm.leavePenaltyAmount}
                        onChange={(e) => setFeeForm({ ...feeForm, leavePenaltyAmount: Number(e.target.value) })} />
                    </div>
                  </div>
                  <p className="text-xs text-indigo-500 mt-1.5">Approved student leave is recorded for reporting only. Student penalties are based on ABSENT attendance, not leave approvals. Emergency &amp; Sick leaves are exempt.</p>
                </div>
                <Button onClick={() => createFee.mutate()} disabled={createFee.isPending}>
                  {createFee.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingFeeId ? 'Update fee policy' : 'Save fee policy'}
                </Button>
                {editingFeeId && <Button variant="outline" onClick={() => setEditingFeeId(null)}>{L('Cancel edit', 'إلغاء التعديل')}</Button>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{L('Active policies', 'السياسات الشغالة')}</CardTitle></CardHeader>
              <CardContent>
                {loadingFee ? (
                  <p className="text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>
                ) : (feePolicies ?? []).length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    {L('No policies yet. Create one before the fee penalty cron runs.', 'لسه مفيش سياسات.')}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{L('Scope', 'النطاق')}</TableHead>
                        <TableHead>{L('Grace', 'السماح')}</TableHead>
                        <TableHead>{L('Late Fee Penalty', 'غرامة التأخير')}</TableHead>
                        <TableHead>{L('Leave Allowance', 'الإجازات المسموحة')}</TableHead>
                        <TableHead>{L('Leave Penalty', 'غرامة الإجازة')}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feePolicies!.map((p: FeePolicy) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-sm">
                            {p.campus?.name ?? 'Global'}
                          </TableCell>
                          <TableCell>{p.graceDays}d</TableCell>
                          <TableCell>
                            {p.penaltyType === 'FIXED' ? `EGP ${p.penaltyValue}` : `${p.penaltyValue}%`}
                            {p.maxPenalty != null ? ` (max ${p.maxPenalty})` : ''}
                          </TableCell>
                          <TableCell className="text-indigo-700 font-semibold">{p.allowedLeavesPerMonth ?? 1}{L('/mo', '/شهر')}</TableCell>
                          <TableCell className="text-red-600 font-semibold">{L('EGP', 'ج.م')} {Number(p.leavePenaltyAmount ?? 0).toLocaleString()}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" className="mr-2" onClick={() => {
                              setEditingFeeId(p.id)
                              setFeeForm({ campusId: p.campusId ?? '', batchId: p.batchId ?? '', graceDays: p.graceDays, penaltyType: p.penaltyType as 'FIXED' | 'PERCENTAGE', penaltyValue: Number(p.penaltyValue), maxPenalty: p.maxPenalty == null ? '' : String(p.maxPenalty), allowedLeavesPerMonth: p.allowedLeavesPerMonth ?? 1, leavePenaltyAmount: Number(p.leavePenaltyAmount ?? 0), allowedAbsencesPerMonth: p.allowedAbsencesPerMonth ?? 3, absencePenaltyAmount: Number(p.absencePenaltyAmount ?? 0) })
                            }}>{L('Edit', 'تعديل')}</Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={deactivateFee.isPending}
                              onClick={() => {
                                if (confirm(L('Deactivate this fee policy?', 'توقّف السياسة دي؟'))) deactivateFee.mutate(p.id)
                              }}
                            >
                              {L('Deactivate', 'وقّف')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="teachers" className="mt-4">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{L('Teacher lateness policy', 'سياسة تأخير المدربين')}</CardTitle>
                <CardDescription>
                  {L('Applied on HR check-in. Cron marks absent if no check-in:', 'بتتطبّق على تسجيل الوصول. المهمة بتسجّل غياب لو مفيش وصول:')} <code className="text-xs">/api/cron/teacher-attendance</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>{L('Campus (optional)', 'الفرع (اختياري)')}</Label>
                  <Select
                    value={teacherForm.campusId || 'global'}
                    onValueChange={(v) => setTeacherForm({ ...teacherForm, campusId: v === 'global' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">{L('All campuses', 'كل الفروع')}</SelectItem>
                      {(campuses ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{L('Late count before multiplier', 'عدد مرات التأخير قبل المضاعفة')}</Label><Input type="number" min={1} value={teacherForm.lateThreshold} onChange={(e) => setTeacherForm({ ...teacherForm, lateThreshold: Number(e.target.value) })} /></div>
                <div>
                  <Label>{L('Penalty type', 'نوع الغرامة')}</Label>
                  <Select value={teacherForm.penaltyType} onValueChange={(v) => setTeacherForm({ ...teacherForm, penaltyType: v as 'FIXED' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">{L('Fixed (EGP)', 'ثابتة (ج.م)')}</SelectItem>
                      <SelectItem value="PERCENTAGE">{L('% of monthly salary', '% من المرتب الشهري')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>{L('Penalty value', 'قيمة الغرامة')}</Label><Input type="number" value={teacherForm.penaltyValue} onChange={(e) => setTeacherForm({ ...teacherForm, penaltyValue: Number(e.target.value) })} /></div>
                <div><Label>{L('Repeat multiplier (optional)', 'مضاعف التكرار (اختياري)')}</Label><Input value={teacherForm.repeatMultiplier} onChange={(e) => setTeacherForm({ ...teacherForm, repeatMultiplier: e.target.value })} placeholder={L('e.g. 2', 'مثلاً 2')} /></div>
                <div className="border-t border-emerald-100 pt-3 mt-1">
                  <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">{L('Attendance and leave rule', 'قاعدة الحضور والإجازة')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-emerald-700">{L('Late grace (minutes)', 'سماح التأخير (دقايق)')}</Label><Input type="number" min={0} max={180} value={teacherForm.lateGraceMinutes} onChange={(e) => setTeacherForm({ ...teacherForm, lateGraceMinutes: Number(e.target.value) })} /></div>
                    <div><Label className="text-emerald-700">{L('Free late passes/Month', 'مرات تأخير مسموحة / شهر')}</Label><Input type="number" min={0} value={teacherForm.freeLatePasses} onChange={(e) => setTeacherForm({ ...teacherForm, freeLatePasses: Number(e.target.value) })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-emerald-700">{L('Allowed Leaves/Month', 'إجازات مسموحة / شهر')}</Label>
                      <Input type="number" min={0} value={teacherForm.allowedLeavesPerMonth}
                        onChange={(e) => setTeacherForm({ ...teacherForm, allowedLeavesPerMonth: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-emerald-700">{L('Leave Deduction (EGP)', 'خصم الإجازة (ج.م)')}</Label>
                      <Input type="number" min={0} value={teacherForm.leavePenaltyAmount}
                        onChange={(e) => setTeacherForm({ ...teacherForm, leavePenaltyAmount: Number(e.target.value) })} />
                    </div>
                  </div>
                  <p className="text-xs text-emerald-600 mt-1.5">A late check-in after the configured grace and beyond free passes creates a pending salary assessment. One approved leave/month is allowed by default; excess approved leave creates a pending assessment. Emergency &amp; Sick leaves are exempt.</p>
                </div>
                <Button onClick={() => createTeacher.mutate()} disabled={createTeacher.isPending}>
                  {createTeacher.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingTeacherId ? 'Update teacher policy' : 'Save teacher policy'}
                </Button>
                {editingTeacherId && <Button variant="outline" onClick={() => setEditingTeacherId(null)}>{L('Cancel edit', 'إلغاء التعديل')}</Button>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{L('Active policies', 'السياسات الشغالة')}</CardTitle></CardHeader>
              <CardContent>
                {loadingTeacher ? (
                  <p className="text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>
                ) : (teacherPolicies ?? []).length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No policies yet. Teachers can still check in; penalties apply once configured.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{L('Campus', 'الفرع')}</TableHead>
                        <TableHead>{L('Lateness Rule', 'قاعدة التأخير')}</TableHead>
                        <TableHead>{L('Leave Allowance', 'الإجازات المسموحة')}</TableHead>
                        <TableHead>{L('Leave Deduction', 'خصم الإجازة')}</TableHead>
                        <TableHead>{L('Grace / Free passes', 'السماح / المرات المسموحة')}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teacherPolicies!.map((p: TeacherPolicy) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.campus?.name ?? 'Global'}</TableCell>
                          <TableCell className="text-sm">
                            {L('After', 'بعد')} {p.lateThreshold} {L('lates/mo:', 'تأخير/شهر:')}{' '}
                            {p.penaltyType === 'FIXED' ? `EGP ${p.penaltyValue}` : `${p.penaltyValue}% salary`}
                            {p.repeatMultiplier ? ` ×${p.repeatMultiplier}` : ''}
                          </TableCell>
                          <TableCell className="text-emerald-700 font-semibold">{p.allowedLeavesPerMonth ?? 1}{L('/mo', '/شهر')}</TableCell>
                          <TableCell className="text-red-600 font-semibold">{L('EGP', 'ج.م')} {Number(p.leavePenaltyAmount ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-emerald-700 font-semibold">{p.lateGraceMinutes ?? 25}m / {p.freeLatePasses ?? 0}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" className="mr-2" onClick={() => {
                              setEditingTeacherId(p.id)
                              setTeacherForm({ campusId: p.campusId ?? '', lateThreshold: p.lateThreshold, penaltyType: p.penaltyType as 'FIXED' | 'PERCENTAGE', penaltyValue: Number(p.penaltyValue), repeatMultiplier: p.repeatMultiplier == null ? '' : String(p.repeatMultiplier), allowedLeavesPerMonth: p.allowedLeavesPerMonth ?? 1, leavePenaltyAmount: Number(p.leavePenaltyAmount ?? 0), lateGraceMinutes: p.lateGraceMinutes ?? 25, freeLatePasses: p.freeLatePasses ?? 0 })
                            }}>{L('Edit', 'تعديل')}</Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={deactivateTeacher.isPending}
                              onClick={() => {
                                if (confirm(L('Deactivate this teacher policy?', 'توقّف سياسة المدربين دي؟'))) deactivateTeacher.mutate(p.id)
                              }}
                            >
                              {L('Deactivate', 'وقّف')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
