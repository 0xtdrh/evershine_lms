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

interface TeacherDetail {
  id: string
  firstName: string
  lastName: string
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
  const params = useParams<{ id: string }>()
  const router = useRouter()

  const { data: teacher, isLoading } = useQuery<TeacherDetail>({
    queryKey: ['teacher-detail', params.id],
    queryFn: () => fetchApi(`/api/teachers/${params.id}`),
  })

  const [form, setForm] = useState({ fixedAmount: '', percentOfStudentPayment: '', perSessionAmount: '' })

  useEffect(() => {
    if (teacher) {
      setForm({
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
          defaultFixedAmount: form.fixedAmount ? Number(form.fixedAmount) : null,
          defaultPercentOfStudentPayment: form.percentOfStudentPayment ? Number(form.percentOfStudentPayment) : null,
          defaultPerSessionAmount: form.perSessionAmount ? Number(form.perSessionAmount) : null,
        }),
      }),
    onSuccess: () => notify.success('Default pay rule saved'),
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to save pay rule')),
  })

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 text-slate-500 -ml-2" onClick={() => router.back()}>
        <ChevronLeft className="w-4 h-4" /> Back
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : teacher ? (
        <Card>
          <CardHeader>
            <CardTitle>{teacher.firstName} {teacher.lastName} — Default Pay Rule</CardTitle>
            <CardDescription>
              Applies to every group this teacher is assigned to, unless that specific group has its own
              override (set from that group&apos;s Financials in the Groups page).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fixed">Fixed amount per cycle</Label>
              <Input id="fixed" type="number" placeholder="e.g. 1500" value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="percent">Percent of what each student pays (%)</Label>
              <Input id="percent" type="number" min="0" max="100" placeholder="e.g. 20" value={form.percentOfStudentPayment} onChange={(e) => setForm({ ...form, percentOfStudentPayment: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perSession">Fixed amount per session taught</Label>
              <Input id="perSession" type="number" placeholder="e.g. 100" value={form.perSessionAmount} onChange={(e) => setForm({ ...form, perSessionAmount: e.target.value })} />
            </div>
            <p className="text-xs text-slate-400">Leave any field blank to not use that component. Combine as many as needed.</p>
            <Button className="w-full" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-400 text-center py-16">Teacher not found.</p>
      )}
    </div>
  )
}
