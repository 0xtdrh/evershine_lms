'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { Loader2, Plus, Layers, GraduationCap, Pencil, Trash2, ChevronLeft } from 'lucide-react'

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
  description: string | null
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

  // ── Navigation: selected track → its courses → a selected course's levels ─
  const [selectedTrackId, setSelectedTrackId] = useState<string | 'unassigned' | null>(null)
  const [selectedCourseId, setSelectedCourseId] = useState<string>('')

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ['academic-subjects-for-config'],
    queryFn: () => fetchApi('/api/academic-subjects'),
  })

  const coursesInTrack = useMemo(() => {
    if (selectedTrackId === 'unassigned') return courses.filter((c) => !c.track)
    if (selectedTrackId) return courses.filter((c) => c.track?.id === selectedTrackId)
    return []
  }, [courses, selectedTrackId])

  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId), [courses, selectedCourseId])
  const selectedTrack = useMemo(() => tracks.find((t) => t.id === selectedTrackId), [tracks, selectedTrackId])

  // ── Course create/edit/delete ────────────────────────────────────────
  const [courseDialogOpen, setCourseDialogOpen] = useState(false)
  const [editingCourse, setEditingCourse] = useState<Course | null>(null)
  const [courseForm, setCourseForm] = useState({ name: '', code: '', description: '' })
  const [deleteCourseTarget, setDeleteCourseTarget] = useState<Course | null>(null)

  const openCreateCourse = () => {
    setEditingCourse(null)
    setCourseForm({ name: '', code: '', description: '' })
    setCourseDialogOpen(true)
  }

  const openEditCourse = (c: Course) => {
    setEditingCourse(c)
    setCourseForm({ name: c.name, code: c.code, description: c.description ?? '' })
    setCourseDialogOpen(true)
  }

  const createCourseMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/academic-subjects', {
        method: 'POST',
        body: JSON.stringify({
          name: courseForm.name,
          code: courseForm.code,
          description: courseForm.description || undefined,
          trackId: selectedTrackId === 'unassigned' ? null : selectedTrackId,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-subjects-for-config'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      notify.success('Course created')
      setCourseDialogOpen(false)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to create course')),
  })

  const updateCourseMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/academic-subjects/${editingCourse?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: courseForm.name,
          description: courseForm.description || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-subjects-for-config'] })
      notify.success('Course updated')
      setCourseDialogOpen(false)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to update course')),
  })

  const deleteCourseMutation = useMutation({
    mutationFn: () => fetchApi(`/api/academic-subjects/${deleteCourseTarget?.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-subjects-for-config'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      notify.success('Course deleted')
      setDeleteCourseTarget(null)
      if (selectedCourseId === deleteCourseTarget?.id) setSelectedCourseId('')
    },
    onError: (err: unknown) => {
      notify.error(apiErrorMessage(err, 'Failed to delete course'))
      setDeleteCourseTarget(null)
    },
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
        <CardDescription>Tracks → courses → levels, all in one place.</CardDescription>
      </div>

      {/* Tracks */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" /> Tracks
            </CardTitle>
            <CardDescription>Tap a track to manage its courses.</CardDescription>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setTrackDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add track
          </Button>
        </CardHeader>
        <CardContent>
          {isTracksLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelectedTrackId(t.id); setSelectedCourseId('') }}
                  className={`text-xs py-1.5 px-3 rounded-full border transition-colors ${
                    selectedTrackId === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t.name}
                  {(t.minAge != null || t.maxAge != null) && (
                    <span className={selectedTrackId === t.id ? 'text-indigo-100 ml-1' : 'text-slate-400 ml-1'}>
                      ({t.minAge ?? '0'}–{t.maxAge ?? '∞'})
                    </span>
                  )}
                  <span className={selectedTrackId === t.id ? 'text-indigo-100 ml-1' : 'text-slate-400 ml-1'}>
                    · {t._count?.courses ?? 0}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setSelectedTrackId('unassigned'); setSelectedCourseId('') }}
                className={`text-xs py-1.5 px-3 rounded-full border transition-colors ${
                  selectedTrackId === 'unassigned' ? 'bg-slate-700 text-white border-slate-700' : 'border-dashed border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Unassigned courses
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Courses in the selected track */}
      {selectedTrackId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-indigo-600" />
                Courses {selectedTrack ? `in ${selectedTrack.name}` : '(unassigned)'}
              </CardTitle>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={openCreateCourse}>
              <Plus className="w-3.5 h-3.5" /> Add course
            </Button>
          </CardHeader>
          <CardContent>
            {coursesInTrack.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No courses here yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {coursesInTrack.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg transition-colors ${
                      selectedCourseId === c.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button type="button" className="text-left flex-1" onClick={() => setSelectedCourseId(c.id)}>
                      <p className="font-medium text-slate-800 text-sm">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.code} · {c._count?.levels ?? 0} levels</p>
                    </button>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditCourse(c)}>
                        <Pencil className="w-3.5 h-3.5 text-slate-500" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDeleteCourseTarget(c)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Levels for the selected course */}
      {selectedCourse && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <Button variant="ghost" size="sm" className="text-xs -ml-2 mb-1 gap-1 text-slate-500" onClick={() => setSelectedCourseId('')}>
                <ChevronLeft className="w-3.5 h-3.5" /> Back to courses
              </Button>
              <CardTitle className="text-base">Levels for {selectedCourse.name}</CardTitle>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLevelDialogOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Add level
            </Button>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

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

      {/* Add/edit course dialog */}
      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCourse ? 'Edit course' : 'New course'}</DialogTitle>
            <DialogDescription>
              {editingCourse ? editingCourse.name : `In ${selectedTrack ? selectedTrack.name : 'Unassigned'}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Course name" value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} />
            <Input
              placeholder="Code (e.g. ROBO)"
              value={courseForm.code}
              disabled={!!editingCourse}
              onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value.toUpperCase() })}
            />
            <Textarea placeholder="Description (optional)" value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
          </div>
          <DialogFooter>
            <Button
              disabled={!courseForm.name || !courseForm.code || createCourseMutation.isPending || updateCourseMutation.isPending}
              onClick={() => (editingCourse ? updateCourseMutation.mutate() : createCourseMutation.mutate())}
            >
              {(createCourseMutation.isPending || updateCourseMutation.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : editingCourse ? 'Save changes' : 'Create course'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete course confirm */}
      <AlertDialog open={!!deleteCourseTarget} onOpenChange={(o) => { if (!o) setDeleteCourseTarget(null) }}>
        <AlertDialogContent className="rounded-2xl max-w-md p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-slate-900">Delete {deleteCourseTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed">
              This is blocked if the course still has levels or is offered to any group — remove those first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 flex-col-reverse sm:flex-row">
            <AlertDialogCancel className="h-10 text-xs sm:text-sm rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" disabled={deleteCourseMutation.isPending} onClick={() => deleteCourseMutation.mutate()}>
                {deleteCourseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
