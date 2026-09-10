'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'
import { Loader2, Save, CheckCircle2, Award, GraduationCap } from 'lucide-react'

interface SubjectOffering {
  id: string
  subject: { id: string; name: string; code: string }
  classSection: { id: string; className: string; sectionName: string }
}

interface ResultRow {
  studentEnrollmentId: string
  student: { id: string; firstName: string; lastName: string; fullNameAr?: string; profilePicture: string | null }
  result: {
    id: string
    homeworkScore: number | null
    taskScore: number | null
    instructorScore: number | null
    projectScore: number | null
    mcqScore: number | null
    finalScore: number | null
    passed: boolean | null
    instructorFeedback: string | null
  } | null
}

interface GradingConfig {
  homeworkWeight: number
  taskWeight: number
  instructorWeight: number
  projectWeight: number
  mcqWeight: number
  passThreshold: number
}

type DraftState = Record<string, {
  homeworkScore: string
  taskScore: string
  instructorScore: string
  projectScore: string
  mcqScore: string
  instructorFeedback: string
}>

export default function LevelResultsPage() {
  const queryClient = useQueryClient()
  const [selectedOfferingId, setSelectedOfferingId] = useState('')
  const [draft, setDraft] = useState<DraftState>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const { data: offerings = [], isLoading: isLoadingOfferings } = useQuery<SubjectOffering[]>({
    queryKey: ['teacher-subject-offerings'],
    queryFn: () => fetchApi<SubjectOffering[]>('/api/teacher-portal/subject-offerings'),
  })

  const selectedOffering = offerings.find((o) => o.id === selectedOfferingId)

  const { data, isLoading: isLoadingResults } = useQuery<{ rows: ResultRow[]; config: GradingConfig }>({
    queryKey: ['level-results', selectedOffering?.classSection.id, selectedOffering?.subject.id],
    queryFn: () => fetchApi<{ rows: ResultRow[]; config: GradingConfig }>(
      `/api/level-results?classSectionId=${selectedOffering!.classSection.id}&subjectId=${selectedOffering!.subject.id}`
    ),
    enabled: !!selectedOffering,
  })

  const getDraftValue = (row: ResultRow, field: keyof DraftState[string]) => {
    if (draft[row.studentEnrollmentId]?.[field] !== undefined) return draft[row.studentEnrollmentId][field]
    if (field === 'instructorFeedback') return row.result?.instructorFeedback ?? ''
    const key = field as 'homeworkScore' | 'taskScore' | 'instructorScore' | 'projectScore' | 'mcqScore'
    const val = row.result?.[key]
    return val != null ? String(val) : ''
  }

  const updateDraft = (studentEnrollmentId: string, field: keyof DraftState[string], value: string) => {
    setDraft((prev) => ({
      ...prev,
      [studentEnrollmentId]: {
        homeworkScore: prev[studentEnrollmentId]?.homeworkScore ?? '',
        taskScore: prev[studentEnrollmentId]?.taskScore ?? '',
        instructorScore: prev[studentEnrollmentId]?.instructorScore ?? '',
        projectScore: prev[studentEnrollmentId]?.projectScore ?? '',
        mcqScore: prev[studentEnrollmentId]?.mcqScore ?? '',
        instructorFeedback: prev[studentEnrollmentId]?.instructorFeedback ?? '',
        [field]: value,
      },
    }))
  }

  const saveMutation = useMutation({
    mutationFn: (row: ResultRow) => {
      const d = draft[row.studentEnrollmentId]
      const toNum = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v))
      return fetchApi('/api/level-results', {
        method: 'POST',
        body: JSON.stringify({
          studentEnrollmentId: row.studentEnrollmentId,
          subjectId: selectedOffering!.subject.id,
          homeworkScore: toNum(d?.homeworkScore),
          taskScore: toNum(d?.taskScore),
          instructorScore: toNum(d?.instructorScore),
          projectScore: toNum(d?.projectScore),
          mcqScore: toNum(d?.mcqScore),
          instructorFeedback: d?.instructorFeedback,
        }),
      })
    },
    onSuccess: (res: any, row) => {
      queryClient.invalidateQueries({ queryKey: ['level-results'] })
      setDraft((prev) => { const next = { ...prev }; delete next[row.studentEnrollmentId]; return next })
      if (res?.certificateIssued) {
        notify.success(`🎉 ${row.student.firstName} passed! A certificate has been issued (hidden until the ceremony).`)
      } else {
        notify.success('Scores saved')
      }
    },
    onError: () => notify.error('Failed to save scores'),
    onSettled: () => setSavingId(null),
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-indigo-600" /> Level Results
        </h1>
        <p className="text-sm text-slate-500 mt-1">Enter each component score — the final grade and pass/fail is calculated automatically.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Select value={selectedOfferingId} onValueChange={setSelectedOfferingId}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder={isLoadingOfferings ? 'Loading your courses...' : 'Select a course & group'} />
            </SelectTrigger>
            <SelectContent>
              {offerings.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.subject.name} — {o.classSection.className} {o.classSection.sectionName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedOffering && data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selectedOffering.subject.name} — {selectedOffering.classSection.className} {selectedOffering.classSection.sectionName}</CardTitle>
            <CardDescription>
              Weights: Homework {data.config.homeworkWeight}% · Tasks {data.config.taskWeight}% · Instructor {data.config.instructorWeight}% · Project {data.config.projectWeight}% · MCQ {data.config.mcqWeight}% — Pass mark: {data.config.passThreshold}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoadingResults ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : (
              data.rows.map((row) => {
                const isDirty = !!draft[row.studentEnrollmentId]
                return (
                  <div key={row.studentEnrollmentId} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{row.student.firstName} {row.student.lastName}</span>
                        {row.result?.passed === true && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1"><Award className="w-3 h-3" /> Passed</Badge>
                        )}
                        {row.result?.passed === false && (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">Not yet passing</Badge>
                        )}
                      </div>
                      {row.result?.finalScore != null && (
                        <span className="text-sm font-bold text-slate-700">{row.result.finalScore}%</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400">Homework</label>
                        <Input type="number" min={0} max={100} value={getDraftValue(row, 'homeworkScore')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'homeworkScore', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400">Tasks</label>
                        <Input type="number" min={0} max={100} value={getDraftValue(row, 'taskScore')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'taskScore', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400">Instructor</label>
                        <Input type="number" min={0} max={100} value={getDraftValue(row, 'instructorScore')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'instructorScore', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400">Project</label>
                        <Input type="number" min={0} max={100} value={getDraftValue(row, 'projectScore')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'projectScore', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400">MCQ</label>
                        <Input type="number" min={0} max={100} value={getDraftValue(row, 'mcqScore')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'mcqScore', e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Instructor Feedback {row.result?.passed === true ? '' : '(required to pass)'}</label>
                      <Textarea rows={2} value={getDraftValue(row, 'instructorFeedback')} onChange={(e) => updateDraft(row.studentEnrollmentId, 'instructorFeedback', e.target.value)} placeholder="Notes on the student's performance this level..." />
                    </div>
                    <div className="flex justify-end mt-3">
                      <Button
                        size="sm"
                        disabled={!isDirty || saveMutation.isPending}
                        onClick={() => { setSavingId(row.studentEnrollmentId); saveMutation.mutate(row) }}
                        className="gap-2"
                      >
                        {saveMutation.isPending && savingId === row.studentEnrollmentId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
