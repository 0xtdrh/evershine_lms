'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { Loader2, ChevronLeft } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface TeacherDetail {
  id: string
  firstName: string
  lastName: string
  monthlySalary: number | null
  defaultFixedAmount: number | null
  defaultPercentOfStudentPayment: number | null
  defaultPerSessionAmount: number | null
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

export default function TeacherCompensationPage() {
  useI18n() // re-render on a language switch
  const params = useParams<{ id: string }>()
  const router = useRouter()

  const { data: teacher, isLoading } = useQuery<TeacherDetail>({
    queryKey: ['teacher-detail', params.id],
    queryFn: () => fetchApi(`/api/teachers/${params.id}`),
  })

  const [form, setForm] = useState({ monthlySalary: '', fixedAmount: '', percentOfStudentPayment: '', perSessionAmount: '' })

  useEffect(() => {
    if (teacher) {
      setForm({
        monthlySalary: teacher.monthlySalary != null ? String(teacher.monthlySalary) : '',
        fixedAmount: teacher.defaultFixedAmount != null ? String(teacher.defaultFixedAmount) : '',
        percentOfStudentPayment: teacher.defaultPercentOfStudentPayment != null ? String(teacher.defaultPercentOfStudentPayment) : '',
        perSessionAmount: teacher.defaultPerSessionAmount != null ? String(teacher.defaultPerSessionAmount) : '',
      })
    }
  }, [teacher])

  const saveMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/teachers/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          monthlySalary: form.monthlySalary ? Number(form.monthlySalary) : null,
          defaultFixedAmount: form.fixedAmount ? Number(form.fixedAmount) : null,
          defaultPercentOfStudentPayment: form.percentOfStudentPayment ? Number(form.percentOfStudentPayment) : null,
          defaultPerSessionAmount: form.perSessionAmount ? Number(form.perSessionAmount) : null,
        }),
      }),
    onSuccess: () => notify.success(L('Pay settings saved', 'إعدادات الأجر اتحفظت')),
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to save pay settings')),
  })

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 text-slate-500 -ml-2" onClick={() => router.back()}>
        <ChevronLeft className="w-4 h-4" /> {L('Back', 'رجوع')}
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : teacher ? (
        <Card>
          <CardHeader>
            <CardTitle>{teacher.firstName} {teacher.lastName} {L('— Pay Settings', '— إعدادات الأجر')}</CardTitle>
            <CardDescription>
              Base monthly salary, plus the default group-pay rule that applies to every group this teacher
              is assigned to (unless a specific group has its own override, set from that group&apos;s
              Financials in the Groups page).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="salary">{L('Fixed monthly salary', 'مرتب شهري ثابت')}</Label>
              <Input id="salary" type="number" placeholder={L('e.g. 6000', 'مثلاً 6000')} value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} />
              <p className="text-xs text-slate-400">The teacher&apos;s base salary, independent of any group.</p>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-4">
              <p className="text-sm font-medium text-slate-700">{L('Default group-pay rule', 'قاعدة أجر الجروبات الافتراضية')}</p>
              <div className="space-y-1.5">
                <Label htmlFor="fixed">{L('Fixed amount per group, per cycle', 'مبلغ ثابت لكل جروب في الشهر')}</Label>
                <Input id="fixed" type="number" placeholder={L('e.g. 1500', 'مثلاً 1500')} value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="percent">{L('Percent of what each student pays (%)', 'نسبة من اللي كل طالب بيدفعه (%)')}</Label>
                <Input id="percent" type="number" min="0" max="100" placeholder={L('e.g. 20', 'مثلاً 20')} value={form.percentOfStudentPayment} onChange={(e) => setForm({ ...form, percentOfStudentPayment: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perSession">{L('Fixed amount per session taught', 'مبلغ ثابت لكل حصة')}</Label>
                <Input id="perSession" type="number" placeholder={L('e.g. 100', 'مثلاً 100')} value={form.perSessionAmount} onChange={(e) => setForm({ ...form, perSessionAmount: e.target.value })} />
              </div>
              <p className="text-xs text-slate-400">{L('Leave any field blank to not use that component. Combine as many as needed — these apply per group the teacher teaches.', 'سيب أي خانة فاضية علشان ماتستخدمهاش. تقدر تجمع أكتر من واحدة — بتتطبّق على كل جروب المدرب بيدرّسه.')}</p>
            </div>

            <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-400 text-center py-16">{L('Teacher not found.', 'المدرب مش موجود.')}</p>
      )}
    </div>
  )
}
