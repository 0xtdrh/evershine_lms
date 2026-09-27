'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'
import { Loader2, ChevronLeft, X } from 'lucide-react'

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

interface Track { id: string; name: string }
interface Course { id: string; name: string; trackId: string | null }
interface Level { id: string; name: string; subjectId: string }

interface QualifiedRow {
  id: string
  track: { id: string; name: string } | null
  subject: { id: string; name: string } | null
  level: { id: string; name: string; subject: { id: string; name: string } } | null
}

interface CredentialRow {
  id: string
  type: 'QUALIFICATION' | 'TRAINING' | 'CERTIFICATE'
  title: string
  institution: string | null
  dateObtained: string | null
  fileUrl: string | null
}

export default function TeacherCapabilitiesPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  // ── Teaching capabilities ────────────────────────────────────────────
  const { data: qualified = [], isLoading: qLoading } = useQuery<QualifiedRow[]>({
    queryKey: ['teacher-qualified', params.id],
    queryFn: () => fetchApi(`/api/teachers/${params.id}/qualified-subjects`),
  })
  const { data: tracks = [] } = useQuery<Track[]>({ queryKey: ['tracks'], queryFn: () => fetchApi('/api/tracks') })
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ['academic-subjects'], queryFn: () => fetchApi('/api/academic-subjects') })

  const [qualScope, setQualScope] = useState<'track' | 'course' | 'level'>('course')
  const [qualTrackId, setQualTrackId] = useState('')
  const [qualCourseId, setQualCourseId] = useState('')
  const [qualLevelId, setQualLevelId] = useState('')

  const { data: levelsForCourse = [] } = useQuery<Level[]>({
    queryKey: ['levels-for-course', qualCourseId],
    queryFn: () => fetchApi(`/api/levels?subjectId=${qualCourseId}`),
    enabled: qualScope === 'level' && !!qualCourseId,
  })

  const addQualifiedMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/teachers/${params.id}/qualified-subjects`, {
        method: 'POST',
        body: JSON.stringify({
          trackId: qualScope === 'track' ? qualTrackId : undefined,
          subjectId: qualScope === 'course' ? qualCourseId : undefined,
          levelId: qualScope === 'level' ? qualLevelId : undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-qualified', params.id] })
      notify.success('Added')
      setQualTrackId(''); setQualCourseId(''); setQualLevelId('')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to add')),
  })

  const removeQualifiedMutation = useMutation({
    mutationFn: (rowId: string) => fetchApi(`/api/teachers/${params.id}/qualified-subjects?rowId=${rowId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teacher-qualified', params.id] }),
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to remove')),
  })

  // ── Credentials ───────────────────────────────────────────────────────
  const { data: credentials = [], isLoading: cLoading } = useQuery<CredentialRow[]>({
    queryKey: ['teacher-credentials', params.id],
    queryFn: () => fetchApi(`/api/teachers/${params.id}/credentials`),
  })

  const [credType, setCredType] = useState<'QUALIFICATION' | 'TRAINING' | 'CERTIFICATE'>('QUALIFICATION')
  const [credTitle, setCredTitle] = useState('')
  const [credInstitution, setCredInstitution] = useState('')
  const [credDate, setCredDate] = useState('')

  const addCredentialMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/teachers/${params.id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({
          type: credType,
          title: credTitle,
          institution: credInstitution || undefined,
          dateObtained: credDate || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-credentials', params.id] })
      notify.success('Added')
      setCredTitle(''); setCredInstitution(''); setCredDate('')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to add')),
  })

  const removeCredentialMutation = useMutation({
    mutationFn: (rowId: string) => fetchApi(`/api/teachers/${params.id}/credentials?rowId=${rowId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teacher-credentials', params.id] }),
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to remove')),
  })

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 text-slate-500 -ml-2" onClick={() => router.back()}>
        <ChevronLeft className="w-4 h-4" /> Back
      </Button>

      {/* Teaching capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>What this teacher can teach</CardTitle>
          <CardDescription>
            Used to suggest substitutes — a whole track covers every course in it, a course covers every level of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {qLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {qualified.length === 0 && <p className="text-sm text-slate-400">Nothing added yet.</p>}
              {qualified.map((q) => (
                <Badge key={q.id} variant="outline" className="gap-1.5 pr-1">
                  {q.track ? `Track: ${q.track.name}` : q.subject ? `Course: ${q.subject.name}` : `${q.level?.subject.name} — ${q.level?.name}`}
                  <button onClick={() => removeQualifiedMutation.mutate(q.id)} className="hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <div className="flex gap-2">
              <Select value={qualScope} onValueChange={(v) => setQualScope(v as typeof qualScope)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="track">Track</SelectItem>
                  <SelectItem value="course">Course</SelectItem>
                  <SelectItem value="level">Level</SelectItem>
                </SelectContent>
              </Select>

              {qualScope === 'track' && (
                <Select value={qualTrackId} onValueChange={setQualTrackId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a track" /></SelectTrigger>
                  <SelectContent>
                    {tracks.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {qualScope === 'course' && (
                <Select value={qualCourseId} onValueChange={setQualCourseId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a course" /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {qualScope === 'level' && (
                <>
                  <Select value={qualCourseId} onValueChange={(v) => { setQualCourseId(v); setQualLevelId('') }}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Course" /></SelectTrigger>
                    <SelectContent>
                      {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={qualLevelId} onValueChange={setQualLevelId} disabled={!qualCourseId}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Level" /></SelectTrigger>
                    <SelectContent>
                      {levelsForCourse.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <Button
              size="sm" className="w-full"
              disabled={
                (qualScope === 'track' && !qualTrackId) ||
                (qualScope === 'course' && !qualCourseId) ||
                (qualScope === 'level' && !qualLevelId) ||
                addQualifiedMutation.isPending
              }
              onClick={() => addQualifiedMutation.mutate()}
            >
              {addQualifiedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Credentials */}
      <Card>
        <CardHeader>
          <CardTitle>Qualifications, training & certificates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : credentials.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing added yet.</p>
          ) : (
            <div className="space-y-2">
              {credentials.map((c) => (
                <div key={c.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{c.title} <span className="text-xs text-slate-400">({c.type})</span></p>
                    <p className="text-xs text-slate-400">{c.institution}{c.dateObtained ? ` · ${c.dateObtained.slice(0, 10)}` : ''}</p>
                  </div>
                  <button onClick={() => removeCredentialMutation.mutate(c.id)} className="text-slate-400 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <div className="flex gap-2">
              <Select value={credType} onValueChange={(v) => setCredType(v as typeof credType)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="QUALIFICATION">Qualification</SelectItem>
                  <SelectItem value="TRAINING">Training</SelectItem>
                  <SelectItem value="CERTIFICATE">Certificate</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Title" value={credTitle} onChange={(e) => setCredTitle(e.target.value)} className="flex-1" />
            </div>
            <div className="flex gap-2">
              <Input placeholder="Institution (optional)" value={credInstitution} onChange={(e) => setCredInstitution(e.target.value)} />
              <Input type="date" value={credDate} onChange={(e) => setCredDate(e.target.value)} />
            </div>
            <Button size="sm" className="w-full" disabled={!credTitle || addCredentialMutation.isPending} onClick={() => addCredentialMutation.mutate()}>
              {addCredentialMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
