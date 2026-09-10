'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'
import { Loader2, Save, Plus, Trash2, Percent, SlidersHorizontal } from 'lucide-react'

interface SubjectOption { id: string; name: string; code: string }

interface GradingConfig {
  id: string
  subjectId: string | null
  subject: SubjectOption | null
  homeworkWeight: number
  taskWeight: number
  instructorWeight: number
  projectWeight: number
  mcqWeight: number
  passThreshold: number
}

type FormState = {
  homeworkWeight: string
  taskWeight: string
  instructorWeight: string
  projectWeight: string
  mcqWeight: string
  passThreshold: string
}

function toFormState(c?: GradingConfig): FormState {
  return {
    homeworkWeight: String(c?.homeworkWeight ?? 20),
    taskWeight: String(c?.taskWeight ?? 20),
    instructorWeight: String(c?.instructorWeight ?? 20),
    projectWeight: String(c?.projectWeight ?? 25),
    mcqWeight: String(c?.mcqWeight ?? 15),
    passThreshold: String(c?.passThreshold ?? 60),
  }
}

function WeightForm({
  form, setForm, onSave, isSaving,
}: {
  form: FormState
  setForm: (f: FormState) => void
  onSave: () => void
  isSaving: boolean
}) {
  const total = ['homeworkWeight', 'taskWeight', 'instructorWeight', 'projectWeight', 'mcqWeight']
    .reduce((sum, k) => sum + (Number(form[k as keyof FormState]) || 0), 0)
  const field = (key: keyof FormState, label: string) => (
    <div className="space-y-1">
      <label className="text-[11px] uppercase font-bold text-slate-500">{label}</label>
      <div className="relative">
        <Input type="number" min={0} max={100} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="pr-7" />
        <Percent className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" />
      </div>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {field('homeworkWeight', 'Homework')}
        {field('taskWeight', 'Tasks')}
        {field('instructorWeight', 'Instructor')}
        {field('projectWeight', 'Final Project')}
        {field('mcqWeight', 'MCQ Exam')}
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={Math.abs(total - 100) < 0.01 ? 'default' : 'destructive'} className={Math.abs(total - 100) < 0.01 ? 'bg-emerald-100 text-emerald-800 border-0' : ''}>
          Total: {total}%
        </Badge>
        {Math.abs(total - 100) >= 0.01 && <span className="text-xs text-red-600">Must add up to exactly 100%</span>}
      </div>
      <div className="max-w-xs space-y-1">
        <label className="text-[11px] uppercase font-bold text-slate-500">Pass Threshold</label>
        <div className="relative">
          <Input type="number" min={0} max={100} value={form.passThreshold} onChange={(e) => setForm({ ...form, passThreshold: e.target.value })} className="pr-7" />
          <Percent className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" />
        </div>
      </div>
      <Button onClick={onSave} disabled={isSaving || Math.abs(total - 100) >= 0.01} className="gap-2">
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </Button>
    </div>
  )
}

export default function GradingConfigPage() {
  const queryClient = useQueryClient()
  const [globalForm, setGlobalForm] = useState<FormState | null>(null)
  const [addingSubjectId, setAddingSubjectId] = useState('')
  const [overrideForms, setOverrideForms] = useState<Record<string, FormState>>({})

  const { data, isLoading } = useQuery<{ globalDefault: GradingConfig; overrides: GradingConfig[] }>({
    queryKey: ['grading-config'],
    queryFn: () => fetchApi('/api/grading-config'),
  })

  const { data: subjects = [] } = useQuery<SubjectOption[]>({
    queryKey: ['academic-subjects-list'],
    queryFn: () => fetchApi('/api/academic-subjects'),
  })

  const saveMutation = useMutation({
    mutationFn: (payload: { subjectId: string | null } & Record<string, number>) =>
      fetchApi('/api/grading-config', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grading-config'] })
      notify.success('Grading configuration saved')
    },
    onError: () => notify.error('Failed to save — check the weights add up to 100%'),
  })

  const deleteMutation = useMutation({
    mutationFn: (subjectId: string) => fetchApi(`/api/grading-config?subjectId=${subjectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grading-config'] })
      notify.success('Override removed — this course now uses the global default')
    },
  })

  const buildPayload = (subjectId: string | null, f: FormState) => ({
    subjectId,
    homeworkWeight: Number(f.homeworkWeight),
    taskWeight: Number(f.taskWeight),
    instructorWeight: Number(f.instructorWeight),
    projectWeight: Number(f.projectWeight),
    mcqWeight: Number(f.mcqWeight),
    passThreshold: Number(f.passThreshold),
  })

  if (isLoading || !data) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  const currentGlobalForm = globalForm ?? toFormState(data.globalDefault)
  const overriddenSubjectIds = new Set(data.overrides.map((o) => o.subjectId))
  const availableSubjects = subjects.filter((s) => !overriddenSubjectIds.has(s.id))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SlidersHorizontal className="w-6 h-6 text-indigo-600" /> Grading Weights
        </h1>
        <p className="text-sm text-slate-500 mt-1">Set the default component weights for all courses, or override them for a specific course.</p>
      </div>

      <Card className="border-t-4 border-t-indigo-500">
        <CardHeader>
          <CardTitle className="text-base">Global Default</CardTitle>
          <CardDescription>Applies to any course that doesn't have its own override below.</CardDescription>
        </CardHeader>
        <CardContent>
          <WeightForm
            form={currentGlobalForm}
            setForm={setGlobalForm}
            isSaving={saveMutation.isPending}
            onSave={() => saveMutation.mutate(buildPayload(null, currentGlobalForm))}
          />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-2">Per-Course Overrides</h2>
        <div className="space-y-4">
          {data.overrides.map((o) => {
            const f = overrideForms[o.subjectId!] ?? toFormState(o)
            return (
              <Card key={o.id}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm">{o.subject?.name}</CardTitle>
                  <Button variant="ghost" size="sm" className="text-red-600 gap-1" onClick={() => deleteMutation.mutate(o.subjectId!)}>
                    <Trash2 className="w-3.5 h-3.5" /> Remove override
                  </Button>
                </CardHeader>
                <CardContent>
                  <WeightForm
                    form={f}
                    setForm={(nf) => setOverrideForms({ ...overrideForms, [o.subjectId!]: nf })}
                    isSaving={saveMutation.isPending}
                    onSave={() => saveMutation.mutate(buildPayload(o.subjectId, f))}
                  />
                </CardContent>
              </Card>
            )
          })}

          <Card className="border-dashed">
            <CardContent className="pt-6 flex items-center gap-3">
              <Select value={addingSubjectId} onValueChange={setAddingSubjectId}>
                <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add an override for a course..." /></SelectTrigger>
                <SelectContent>
                  {availableSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={!addingSubjectId}
                onClick={() => {
                  const f = toFormState()
                  setOverrideForms({ ...overrideForms, [addingSubjectId]: f })
                  saveMutation.mutate(buildPayload(addingSubjectId, f))
                  setAddingSubjectId('')
                }}
              >
                <Plus className="w-4 h-4" /> Add
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
