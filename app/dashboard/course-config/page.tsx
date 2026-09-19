'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { Loader2, Plus, Layers, GraduationCap } from 'lucide-react'

interface Track {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
  description: string | null
  isActive: boolean
  _count?: { courses: number }
}

interface Course {
  id: string
  name: string
  code: string
  track: { id: string; name: string } | null
  _count?: { levels: number }
}

interface Level {
  id: string
  subjectId: string
  name: string
  order: number
  numberOfMonths: number
  numberOfSessions: number
  pricingType: 'MONTHLY' | 'FULL_LEVEL'
  monthlyPrice: number | null
  fullLevelPrice: number | null
  _count?: { classSections: number }
}

function sessionsPerWeekLabel(months: number, sessions: number): string {
  const weeks = months * 4.345
  const perWeek = sessions / weeks
  if (perWeek <= 0) return '—'
  return `≈ ${perWeek.toFixed(1)}x / week`
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

export default function CourseConfigPage() {
  const queryClient = useQueryClient()

  // ── Tracks ────────────────────────────────────────────────────────────
  const { data: tracks = [], isLoading: isTracksLoading } = useQuery<Track[]>({
    queryKey: ['tracks'],
    queryFn: () => fetchApi('/api/tracks'),
  })

  const [trackDialogOpen, setTrackDialogOpen] = useState(false)
  const [trackForm, setTrackForm] = useState({ name: '', minAge: '', maxAge: '', description: '' })

  const createTrackMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/tracks', {
        method: 'POST',
        body: JSON.stringify({
          name: trackForm.name,
          minAge: trackForm.minAge ? Number(trackForm.minAge) : null,
          maxAge: trackForm.maxAge ? Number(trackForm.maxAge) : null,
          description: trackForm.description || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      notify.success('Track created')
      setTrackDialogOpen(false)
      setTrackForm({ name: '', minAge: '', maxAge: '', description: '' })
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to create track')),
  })

  // ── Courses ───────────────────────────────────────────────────────────
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ['academic-subjects-for-config'],
    queryFn: () => fetchApi('/api/academic-subjects'),
  })

  const [selectedCourseId, setSelectedCourseId] = useState<string>('')
  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId), [courses, selectedCourseId])

  const assignTrackMutation = useMutation({
    mutationFn: (trackId: string | null) =>
      fetchApi(`/api/academic-subjects/${selectedCourseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ trackId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-subjects-for-config'] })
      notify.success('Track assignment updated')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to update track assignment')),
  })

  // ── Levels for the selected course ──────────────────────────────────────
  const { data: levels = [], isLoading: isLevelsLoading } = useQuery<Level[]>({
    queryKey: ['levels', selectedCourseId],
    queryFn: () => fetchApi(`/api/levels?subjectId=${selectedCourseId}`),
    enabled: !!selectedCourseId,
  })

  const [levelDialogOpen, setLevelDialogOpen] = useState(false)
  const [levelForm, setLevelForm] = useState({
    name: '',
    order: '',
    numberOfMonths: '',
    numberOfSessions: '',
    pricingType: 'MONTHLY' as 'MONTHLY' | 'FULL_LEVEL',
    monthlyPrice: '',
    fullLevelPrice: '',
  })

  const createLevelMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/levels', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: selectedCourseId,
          name: levelForm.name,
          order: Number(levelForm.order),
          numberOfMonths: Number(levelForm.numberOfMonths),
          numberOfSessions: Number(levelForm.numberOfSessions),
          pricingType: levelForm.pricingType,
          monthlyPrice: levelForm.monthlyPrice ? Number(levelForm.monthlyPrice) : null,
          fullLevelPrice: levelForm.fullLevelPrice ? Number(levelForm.fullLevelPrice) : null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['levels', selectedCourseId] })
      queryClient.invalidateQueries({ queryKey: ['academic-subjects-for-config'] })
      notify.success('Level created')
      setLevelDialogOpen(false)
      setLevelForm({ name: '', order: '', numberOfMonths: '', numberOfSessions: '', pricingType: 'MONTHLY', monthlyPrice: '', fullLevelPrice: '' })
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to create level')),
  })

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Course Structure</h1>
        <CardDescription>Tracks, and each course&apos;s levels — session count, duration, and pricing.</CardDescription>
      </div>

      {/* Tracks */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" /> Tracks
            </CardTitle>
            <CardDescription>Age-based groupings above courses.</CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setTrackDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add track
          </Button>
        </CardHeader>
        <CardContent>
          {isTracksLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : tracks.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No tracks yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tracks.map((t) => (
                <Badge key={t.id} variant="outline" className="text-xs py-1.5 px-3">
                  {t.name}
                  {(t.minAge != null || t.maxAge != null) && (
                    <span className="text-slate-400 ml-1">
                      ({t.minAge ?? '0'}–{t.maxAge ?? '∞'})
                    </span>
                  )}
                  <span className="text-slate-400 ml-1">· {t._count?.courses ?? 0} courses</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Courses & levels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-indigo-600" /> Course levels
          </CardTitle>
          <CardDescription>Pick a course to manage its levels and track assignment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Choose a course..." /></SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedCourse && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Track:</span>
                <Select
                  value={selectedCourse.track?.id ?? 'none'}
                  onValueChange={(v) => assignTrackMutation.mutate(v === 'none' ? null : v)}
                >
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not assigned</SelectItem>
                    {tracks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Levels for {selectedCourse.name}</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLevelDialogOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add level
                </Button>
              </div>

              {isLevelsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
              ) : levels.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No levels yet for this course.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Level</TableHead>
                      <TableHead className="text-center">Duration</TableHead>
                      <TableHead className="text-center">Sessions</TableHead>
                      <TableHead className="text-center">Frequency</TableHead>
                      <TableHead className="text-center">Pricing</TableHead>
                      <TableHead className="text-center">Groups</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {levels.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <p className="font-medium text-slate-800">{l.name}</p>
                          <p className="text-xs text-slate-400">#{l.order}</p>
                        </TableCell>
                        <TableCell className="text-center">{l.numberOfMonths} mo</TableCell>
                        <TableCell className="text-center">{l.numberOfSessions}</TableCell>
                        <TableCell className="text-center text-xs text-slate-500">
                          {sessionsPerWeekLabel(l.numberOfMonths, l.numberOfSessions)}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {l.pricingType === 'MONTHLY'
                            ? `${l.monthlyPrice ?? '—'} / month`
                            : `${l.fullLevelPrice ?? '—'} full level`}
                        </TableCell>
                        <TableCell className="text-center">{l._count?.classSections ?? 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add track dialog */}
      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New track</DialogTitle>
            <DialogDescription>An age-based grouping above courses (e.g. &quot;Kids 4–7&quot;).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name" value={trackForm.name} onChange={(e) => setTrackForm({ ...trackForm, name: e.target.value })} />
            <div className="flex gap-3">
              <Input placeholder="Min age" type="number" value={trackForm.minAge} onChange={(e) => setTrackForm({ ...trackForm, minAge: e.target.value })} />
              <Input placeholder="Max age" type="number" value={trackForm.maxAge} onChange={(e) => setTrackForm({ ...trackForm, maxAge: e.target.value })} />
            </div>
            <Textarea placeholder="Description (optional)" value={trackForm.description} onChange={(e) => setTrackForm({ ...trackForm, description: e.target.value })} />
          </div>
          <DialogFooter>
            <Button
              disabled={!trackForm.name || createTrackMutation.isPending}
              onClick={() => createTrackMutation.mutate()}
            >
              {createTrackMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create track'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add level dialog */}
      <Dialog open={levelDialogOpen} onOpenChange={setLevelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New level</DialogTitle>
            <DialogDescription>For {selectedCourse?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Level name (e.g. Level 1)" value={levelForm.name} onChange={(e) => setLevelForm({ ...levelForm, name: e.target.value })} />
            <Input placeholder="Order (1, 2, 3...)" type="number" value={levelForm.order} onChange={(e) => setLevelForm({ ...levelForm, order: e.target.value })} />
            <div className="flex gap-3">
              <Input placeholder="Months" type="number" value={levelForm.numberOfMonths} onChange={(e) => setLevelForm({ ...levelForm, numberOfMonths: e.target.value })} />
              <Input placeholder="Sessions" type="number" value={levelForm.numberOfSessions} onChange={(e) => setLevelForm({ ...levelForm, numberOfSessions: e.target.value })} />
            </div>
            <Select value={levelForm.pricingType} onValueChange={(v) => setLevelForm({ ...levelForm, pricingType: v as 'MONTHLY' | 'FULL_LEVEL' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">Monthly subscription</SelectItem>
                <SelectItem value="FULL_LEVEL">Full-level price</SelectItem>
              </SelectContent>
            </Select>
            {levelForm.pricingType === 'MONTHLY' ? (
              <Input placeholder="Monthly price" type="number" value={levelForm.monthlyPrice} onChange={(e) => setLevelForm({ ...levelForm, monthlyPrice: e.target.value })} />
            ) : (
              <Input placeholder="Full-level price" type="number" value={levelForm.fullLevelPrice} onChange={(e) => setLevelForm({ ...levelForm, fullLevelPrice: e.target.value })} />
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!levelForm.name || !levelForm.order || !levelForm.numberOfMonths || !levelForm.numberOfSessions || createLevelMutation.isPending}
              onClick={() => createLevelMutation.mutate()}
            >
              {createLevelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create level'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
