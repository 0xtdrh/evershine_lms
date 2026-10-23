'use client'

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchPaginatedApi, fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckCircle, XCircle, Search, Calendar, User, MapPin, Loader2, Building2, Phone, AlertCircle, Trash2 } from 'lucide-react'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Skeleton } from '@/components/ui/skeleton'
import { motion, AnimatePresence } from 'framer-motion'
import { fadeUp, staggerContainer } from '@/lib/animations'
import { EmptyState } from '@/components/shared/empty-state'
import { batchRequiresGenderSeparation, genderSeparationHint } from '@/lib/academic/gender-policy'
import { L, useI18n } from '@/lib/i18n/client'
import { campusLabel } from '@/lib/places/label'

interface AdmissionRequest {
  id: string
  firstName: string
  lastName: string
  fullNameAr: string
  fullNameEn?: string
  fatherName: string
  motherName?: string
  dateOfBirth: string
  gender: string
  bloodGroup?: string
  nationality: string
  address: string
  city: string
  phoneNumber: string
  emergencyContact: string
  email?: string

  guardianFirstName?: string
  guardianLastName?: string
  guardianPhoneNumber?: string
  guardianEmail?: string
  guardianRelationship?: string
  fatherPhoneNumber?: string
  fatherOccupation?: string
  motherPhoneNumber?: string
  motherOccupation?: string
  parentStatus?: string

  schoolName?: string
  regularSchoolGrade?: string
  priorProgrammingExperience?: string

  passportPhotoUrl?: string
  medicalNotes?: string
  hasSiblingAtAcademy: boolean
  siblingName?: string
  siblingClass?: string

  preferredCampusId?: string
  preferredBatchId?: string
  preferredShift?: string
  preferredClassSectionId?: string
  deliveryMode: string

  status: 'PENDING' | 'APPROVED' | 'DECLINED'
  createdAt: string
}

export default function AdmissionsDashboard() {
  useI18n() // re-render on a language switch
  const { data: session, status } = useSession()
  const userRole = session?.user?.role as string | undefined
  const canManageAdmissions = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'BRANCH_MANAGER' || userRole === 'SECRETARY' || userRole === 'MARKETING'
  // action buttons follow the same permissions as the APIs (approve / decline / delete)
  const { can } = useMyPermissions()
  const canApprove = can('admissions', 'approve')
  const canDecline = can('admissions', 'update')
  const canDeleteRequest = can('admissions', 'delete')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [selectedRequest, setSelectedRequest] = useState<AdmissionRequest | null>(null)
  const [requestToDelete, setRequestToDelete] = useState<AdmissionRequest | null>(null)

  // Assignment State
  const [campusId, setCampusId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [classId, setClassId] = useState('')
  const [section, setSection] = useState('')
  const [houseId, setHouseId] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [admissionFee, setAdmissionFee] = useState(0)
  const [courseFee, setCourseFee] = useState(0)
  const [totalAcademicFee, setTotalAcademicFee] = useState(0)
  const [manualTotalOverride, setManualTotalOverride] = useState(false)
  const [shift, setShift] = useState<'MORNING' | 'EVENING' | 'NIGHT'>('MORNING')
  const [deliveryMode, setDeliveryMode] = useState<'PHYSICAL' | 'ONLINE' | 'HYBRID'>('PHYSICAL')
  const [classSectionId, setClassSectionId] = useState('')

  const queryClient = useQueryClient()

  const resetAssignmentState = () => {
    setCampusId('')
    setBatchId('')
    setClassId('')
    setSection('')
    setHouseId('')
    setRollNumber('')
    setAdmissionFee(0)
    setCourseFee(0)
    setTotalAcademicFee(0)
    setManualTotalOverride(false)
    setShift('MORNING')
    setDeliveryMode('PHYSICAL')
    setClassSectionId('')
  }

  const openReviewDialog = (request: AdmissionRequest) => {
    resetAssignmentState()
    setSelectedRequest(request)
    setCampusId(request.preferredCampusId || '')
    setBatchId(request.preferredBatchId || '')
    setClassSectionId(request.preferredClassSectionId || '')
    setShift((request.preferredShift as typeof shift) || 'MORNING')
    setDeliveryMode((request.deliveryMode as typeof deliveryMode) || 'PHYSICAL')
  }

  const closeReviewDialog = () => {
    if (approveMutation.isPending || declineMutation.isPending) return
    setSelectedRequest(null)
    resetAssignmentState()
  }

  // Queries
  const { data: reqData, isLoading } = useQuery({
    queryKey: ['admissions', statusFilter],
    queryFn: () => fetchPaginatedApi<AdmissionRequest>(`/api/admissions?status=${statusFilter}&limit=20`),
    enabled: canManageAdmissions,
  })

  const { data: campusesData } = useQuery({
    queryKey: ['campuses', 'paged'],
    queryFn: () => fetchPaginatedApi<any>('/api/campuses'),
    enabled: canManageAdmissions && !!selectedRequest
  })

  const { data: batchesData } = useQuery({
    queryKey: ['batches', 'paged', campusId],
    queryFn: () => fetchPaginatedApi<any>(`/api/batches?campusId=${campusId}`),
    enabled: canManageAdmissions && !!campusId
  })

  const { data: classesData, isLoading: isLoadingClasses } = useQuery({
    queryKey: ['classes', 'paged', campusId, batchId],
    queryFn: () =>
      fetchPaginatedApi<any>(
        `/api/classes?campusId=${campusId}&batchId=${batchId}&limit=200`
      ),
    enabled: canManageAdmissions && !!campusId && !!batchId,
  })

  const { data: housesData } = useQuery({
    queryKey: ['houses', 'paged', batchId],
    queryFn: () => fetchPaginatedApi<any>(`/api/houses?batchId=${batchId}`),
    enabled: canManageAdmissions && !!batchId
  })

  const { data: classSectionsData } = useQuery({
    queryKey: ['class-sections', campusId],
    queryFn: () => fetchApi<any[]>(`/api/class-sections?campusId=${campusId}`),
    enabled: !!campusId,
  })

  const requests = reqData?.data ?? []
  const campuses = campusesData?.data ?? []
  const classSections = Array.isArray(classSectionsData)
    ? classSectionsData
    : ((classSectionsData as { data?: any[] } | undefined)?.data ?? [])
  const autoAcademicTotal = admissionFee + courseFee

  useEffect(() => {
    if (selectedRequest) {
      setAdmissionFee(0)
      setCourseFee(0)
      setTotalAcademicFee(0)
      setManualTotalOverride(false)
    } else {
      setAdmissionFee(0)
      setCourseFee(0)
      setTotalAcademicFee(0)
      setManualTotalOverride(false)
    }
  }, [selectedRequest])

  useEffect(() => {
    if (!manualTotalOverride) {
      setTotalAcademicFee(admissionFee + courseFee)
    }
  }, [admissionFee, courseFee, manualTotalOverride])

  // Data aggregation from queries
  const batches = batchesData?.data ?? []
  const classesRaw = (classesData as any)?.data ?? (Array.isArray(classesData) ? classesData : [])
  const houses = (housesData as any)?.data ?? (Array.isArray(housesData) ? housesData : [])
  const activeBatch = batches.find((b: any) => b.id === batchId)
  const studentGender = selectedRequest?.gender
  const batchRequiresSeparation = activeBatch ? batchRequiresGenderSeparation(activeBatch.academicLevel, activeBatch.forceGenderSeparation) : false

  const campusOptionDisabled = (campus: any) => {
    if (!batchRequiresSeparation || !studentGender) return false
    return !campus.gender || campus.gender !== studentGender
  }

  const campusSelectionHint = activeBatch
    ? genderSeparationHint(activeBatch, studentGender)
    : ''

  // Reactive Class Filtering: If a batch is selected, show only relevant classes
  // PROFESSIONAL FILTERING & GROUPING
  let compatibleClasses: any[] = []
  let otherClasses: any[] = []

  if (batchId) {
    const level = activeBatch?.academicLevel
    const batchLabel = (activeBatch?.name + (activeBatch?.code || '')).toLowerCase()

    // Determine compatibility
    classesRaw.forEach((c: any) => {
      const isDirectMatch = c.batchId === batchId
      let isGradeMatch = false

      if (level === 'Secondary' || batchLabel.includes('matric')) {
        // Matriculation Tier: Grades 9–10
        isGradeMatch = c.grade === 9 || c.grade === 10
      } else if (level === 'HigherSecondary' || batchLabel.includes('inter') || batchLabel.includes('college')) {
        // Intermediate/College Tier: Grades 11–12
        isGradeMatch = c.grade === 11 || c.grade === 12
      } else if (level === 'Middle' || batchLabel.includes('junior') || batchLabel.includes('middle')) {
        // Junior Tier: Grades 6–8
        isGradeMatch = c.grade >= 6 && c.grade <= 8
      } else if (level === 'Elementary' || batchLabel.includes('kids') || batchLabel.includes('primary')) {
        // Kids Tier: Grades 1–5
        isGradeMatch = c.grade >= 1 && c.grade <= 5
      } else if (level === 'PreSchool') {
        isGradeMatch = c.grade === 0
      }

      if (isDirectMatch || isGradeMatch) {
        compatibleClasses.push(c)
      } else {
        otherClasses.push(c)
      }
    })
  } else {
    compatibleClasses = classesRaw
  }

  // Sort groups
  const sortedCompatible = [...compatibleClasses].sort((a, b) => a.grade - b.grade)
  const sortedOther = [...otherClasses].sort((a, b) => a.grade - b.grade)

  // Use compatible classes for the primary list, but we'll show otherClasses as a fallback group
  const classes = sortedCompatible.length > 0 ? sortedCompatible : sortedOther
  const grades = Array.from(new Set(classes.map((c: any) => c.grade))).sort((a, b) => (a as any) - (b as any))
  const hasCompatible = sortedCompatible.length > 0

  // Restrictions removed: All campus batches and classes are now visible for the admin to choose


  // Approval Mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      return fetchApi(`/api/admissions/${selectedRequest?.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          campusId,
          classId: classId || undefined,
          // roll number = registration number (server); fees come from the level price / extra fees
          shift,
          deliveryMode,
          classSectionId: classSectionId || undefined,
        })
      })
    },
    onSuccess: () => {
      notify.success(L('Admission approved and student profile generated!', 'اتوافق على التسجيل واتعمل ملف الطالب!'))
      queryClient.invalidateQueries({ queryKey: ['admissions'] })
      setSelectedRequest(null)
      resetAssignmentState()
    },
    onError: (err: any) => {
      notify.error(err.message || 'Failed to approve admission')
    }
  })

  const declineMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string, reason: string }) => {
      const res = await fetch(`/api/admissions/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      if (!res.ok) throw new Error('Failed to decline request')
      return res.json()
    },
    onSuccess: () => {
      notify.success(L('Admission request declined', 'طلب التسجيل اترفض'))
      queryClient.invalidateQueries({ queryKey: ['admissions'] })
      setSelectedRequest(null)
    },
    onError: (err: any) => notify.error(err.message)
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return fetchApi(`/api/admissions/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      notify.success(L('Admission request deleted successfully', 'طلب التسجيل اتمسح'))
      queryClient.invalidateQueries({ queryKey: ['admissions'] })
      setRequestToDelete(null)
    },
    onError: (err: any) => notify.error(err.message || 'Failed to delete request')
  })

  const handleApprove = () => {
    if (!campusId) {
      notify.error(L('Please choose the branch before approving', 'اختار الفرع قبل الموافقة'))
      return
    }
    if (admissionFee < 0) {
      notify.error(L('Admission fee must be zero or a positive number', 'مصاريف التسجيل لازم تبقى صفر أو أكتر'))
      return
    }
    if (courseFee < 0) {
      notify.error(L('Course fee must be zero or a positive number', 'مصاريف الكورس لازم تبقى صفر أو أكتر'))
      return
    }
    if (totalAcademicFee < 0) {
      notify.error(L('Total academic fee must be zero or a positive number', 'الإجمالي لازم يبقى صفر أو أكتر'))
      return
    }
    if (totalAcademicFee < admissionFee + courseFee) {
      notify.error(L('Total academic fee must be at least the sum of admission fee and course fee', 'الإجمالي لازم يبقى على الأقل مجموع مصاريف التسجيل والكورس'))
      return
    }
    approveMutation.mutate()
  }

  // Route guard: only SUPER_ADMIN and ADMIN can access admissions management
  if (status === 'loading') return null
  if (!canManageAdmissions) {
    return (
      <AccessDenied
        title={L('Admissions Access Restricted', 'طلبات التسجيل مقفولة')}
        message="Only administrators can review and approve student admission requests. Teachers and students cannot access this module."
      />
    )
  }

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={staggerContainer}
      className="space-y-6 max-w-7xl mx-auto"
    >
      <motion.div variants={fadeUp(0.1)} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl shadow-soft-lg border border-slate-200/60">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
              <User className="w-6 h-6" />
            </div>
            {L('Admission Requests', 'طلبات التسجيل')}
          </h1>
          <p className="text-sm text-slate-500 mt-1 font-medium ml-11">{L('Review online applications, place candidates in a branch, and generate student profiles.', 'راجع طلبات الأونلاين، وسكّن المتقدمين في فرع، واعمل ملفات الطلاب.')}</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp(0.2)} className="bg-white rounded-2xl border border-slate-200/60 shadow-soft-md overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder={L('Search CNIC or Name...', 'دوّر بالرقم القومي أو الاسم...')}
                className="pl-9 bg-white border-slate-200"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] bg-white border-slate-200">
                <SelectValue placeholder={L('Status', 'الحالة')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">{L('Pending Review', 'مستني مراجعة')}</SelectItem>
                <SelectItem value="APPROVED">{L('Approved', 'اتوافق')}</SelectItem>
                <SelectItem value="DECLINED">{L('Declined', 'اترفض')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="relative w-full overflow-x-auto min-h-[400px]">
          <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>{L('Applicant Name', 'اسم المتقدم')}</TableHead>
                  <TableHead>{L('Phone', 'التليفون')}</TableHead>
                  <TableHead>{L('Preferred time', 'الوقت المناسب')}</TableHead>
                  <TableHead>{L('Delivery Mode', 'طريقة الحضور')}</TableHead>
                  <TableHead>{L('Applied Date', 'تاريخ الطلب')}</TableHead>
                  <TableHead>{L('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-right">{L('Action', 'إجراء')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : requests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64">
                      <EmptyState
                        icon={User}
                        title={`No ${statusFilter.toLowerCase()} requests`}
                        description={search ? "Try adjusting your search criteria." : `There are currently no admission requests with the status: ${statusFilter}.`}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((req) => (
                    <TableRow key={req.id} className="hover:bg-slate-50/80 transition-colors group">
                      <TableCell>
                        <p className="font-medium">{req.firstName} {req.lastName}</p>
                        <p className="text-xs text-gray-500">{req.gender} • {req.phoneNumber}</p>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{req.phoneNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 font-semibold">{req.preferredShift || 'N/A'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-purple-50 text-purple-700 font-semibold">{req.deliveryMode}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {new Date(req.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          req.status === 'PENDING' ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                          req.status === 'APPROVED' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                          'bg-red-100 text-red-700 hover:bg-red-100'
                        }>
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {req.status === 'PENDING' && (
                            <>
                              {(canApprove || canDecline) && <Button size="sm" onClick={() => openReviewDialog(req)} className="gap-2">
                                {L('Review & Assign', 'راجع وسكّن')} <CheckCircle className="w-4 h-4" />
                              </Button>}
                                {canDeleteRequest && <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setRequestToDelete(req)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>}
                            </>
                          )}
                          {req.status === 'APPROVED' && (
                            <Badge variant="secondary" className="bg-green-50 text-green-700">{L('Account Active', 'الحساب شغال')}</Badge>
                          )}
                          {req.status === 'DECLINED' && canDeleteRequest && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600"
                              onClick={() => setRequestToDelete(req)}
                            >
                              <Trash2 className="w-4 h-4" /> {L('Delete', 'امسح')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </div>
      </motion.div>

      {/* Approval & Assignment Modal */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => { if (!open) closeReviewDialog() }}>
        <DialogContent
          className="sm:max-w-[750px] max-h-[90vh] overflow-y-auto"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{L('Review & Assign Candidate', 'راجع وسكّن المتقدم')}</DialogTitle>
            <DialogDescription>
              {L('Review the complete admission application and map the applicant to academic structures.', 'راجع الطلب كامل وسكّن المتقدم.')}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <Tabs defaultValue="review" className="w-full mt-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="review">{L('Application Review', 'مراجعة الطلب')}</TabsTrigger>
                <TabsTrigger value="assign">{L('Assign & Approve', 'سكّن ووافق')}</TabsTrigger>
              </TabsList>

              {/* TAB 1: APPLICATION REVIEW */}
              <TabsContent value="review" className="space-y-6 py-4 outline-none">
                {/* Applicant Summary */}
                <div className="flex gap-4 bg-gray-50 p-4 rounded-lg border items-start">
                  <div className="w-24 h-24 shrink-0 bg-white border rounded-md overflow-hidden flex items-center justify-center">
                    {selectedRequest.passportPhotoUrl ? (
                      <img src={selectedRequest.passportPhotoUrl} alt={L('Applicant Photo', 'صورة المتقدم')} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-blue-100 text-blue-700 flex items-center justify-center text-3xl font-bold">
                        {selectedRequest.firstName[0]}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-xl text-gray-900">{selectedRequest.firstName} {selectedRequest.lastName}</h3>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm text-gray-600 mt-3">
                      <span className="flex items-center gap-1.5"><User className="w-4 h-4 text-slate-400"/> {L('Gender:', 'النوع:')} <span className="font-medium text-slate-900">{selectedRequest.gender}</span></span>
                      <span className="flex items-center gap-1.5"><Building2 className="w-4 h-4 text-slate-400"/> {L('Delivery Mode:', 'طريقة الحضور:')} <span className="font-medium text-slate-900">{selectedRequest.deliveryMode}</span></span>
                      <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate-400"/> {L('Phone:', 'التليفون:')} <span className="font-medium text-slate-900">{selectedRequest.phoneNumber}</span></span>
                      <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-slate-400"/> {L('DOB:', 'تاريخ الميلاد:')} <span className="font-medium text-slate-900">{new Date(selectedRequest.dateOfBirth).toLocaleDateString('en-GB')}</span></span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Personal & Family */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 border-b pb-1 mb-2">{L('Family Details', 'بيانات الأسرة')}</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Father', 'الأب')}</dt><dd className="font-medium text-slate-900">{selectedRequest.fatherName}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Father Phone', 'تليفون الأب')}</dt><dd className="font-medium text-slate-900">{selectedRequest.fatherPhoneNumber || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Father Occ.', 'شغل الأب')}</dt><dd className="font-medium text-slate-900">{selectedRequest.fatherOccupation || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Mother', 'الأم')}</dt><dd className="font-medium text-slate-900">{selectedRequest.motherName || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Mother Phone', 'تليفون الأم')}</dt><dd className="font-medium text-slate-900">{selectedRequest.motherPhoneNumber || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Mother Occ.', 'شغل الأم')}</dt><dd className="font-medium text-slate-900">{selectedRequest.motherOccupation || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Parent Status', 'حالة الوالدين')}</dt><dd className="font-medium text-slate-900">{selectedRequest.parentStatus || 'N/A'}</dd></div>
                      </dl>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900 border-b pb-1 mb-2">{L('Contact Info', 'بيانات التواصل')}</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Phone', 'التليفون')}</dt><dd className="font-medium text-slate-900">{selectedRequest.phoneNumber}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Emergency', 'رقم الطوارئ')}</dt><dd className="font-medium text-slate-900">{selectedRequest.emergencyContact || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Email', 'الإيميل')}</dt><dd className="font-medium text-slate-900">{selectedRequest.email || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('City', 'المدينة')}</dt><dd className="font-medium text-slate-900">{selectedRequest.city || 'N/A'}</dd></div>
                      </dl>
                    </div>

                    {selectedRequest.guardianFirstName && (
                      <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 text-sm">
                        <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                          <User className="w-4 h-4"/> {L('Guardian Info', 'بيانات ولي الأمر')}
                        </h4>
                        <dl className="space-y-1">
                          <div className="flex justify-between"><dt className="text-blue-700">{L('Name', 'الاسم')}</dt><dd className="font-medium text-slate-900">{selectedRequest.guardianFirstName} {selectedRequest.guardianLastName}</dd></div>
                          <div className="flex justify-between"><dt className="text-blue-700">{L('Relation', 'صلة القرابة')}</dt><dd className="font-medium text-slate-900">{selectedRequest.guardianRelationship}</dd></div>
                          <div className="flex justify-between"><dt className="text-blue-700">{L('Phone', 'التليفون')}</dt><dd className="font-medium text-slate-900">{selectedRequest.guardianPhoneNumber}</dd></div>
                          <div className="flex justify-between"><dt className="text-blue-700">{L('Email', 'الإيميل')}</dt><dd className="font-medium text-slate-900">{selectedRequest.guardianEmail || 'N/A'}</dd></div>
                        </dl>
                      </div>
                    )}
                  </div>

                  {/* School Background & Documents */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 border-b pb-1 mb-2">{L('School Background', 'المدرسة')}</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between"><dt className="text-slate-500">{L('School', 'المدرسة')}</dt><dd className="font-medium text-slate-900 text-right">{selectedRequest.schoolName || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Grade', 'السنة')}</dt><dd className="font-medium text-slate-900 text-right">{selectedRequest.regularSchoolGrade || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Prior Experience', 'خبرة سابقة')}</dt><dd className="font-medium text-slate-900 text-right">{selectedRequest.priorProgrammingExperience || 'N/A'}</dd></div>
                      </dl>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900 border-b pb-1 mb-2">{L('Medical & Additional', 'بيانات طبية وإضافية')}</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Blood Group', 'فصيلة الدم')}</dt><dd className="font-medium text-slate-900">{selectedRequest.bloodGroup || 'N/A'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Medical Notes', 'ملاحظات طبية')}</dt><dd className="font-medium text-slate-900 text-right">{selectedRequest.medicalNotes || 'None'}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-500">{L('Sibling at Academy', 'أخ / أخت عندنا')}</dt><dd className="font-medium text-slate-900">{selectedRequest.hasSiblingAtAcademy ? 'Yes' : 'No'}</dd></div>
                        {selectedRequest.hasSiblingAtAcademy && selectedRequest.siblingName && (
                          <div className="mt-1 bg-blue-50 p-2 rounded border border-blue-100 text-blue-700 text-xs">
                            <strong>{L('Sibling:', 'الأخ / الأخت:')}</strong> {selectedRequest.siblingName} ({selectedRequest.siblingClass || 'N/A'})
                          </div>
                        )}
                      </dl>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-slate-900 border-b pb-1">{L('Documents Uploaded', 'المستندات المرفوعة')}</h4>
                      <div className="grid grid-cols-1 gap-2">
                        {selectedRequest.passportPhotoUrl ? (
                          <a href={selectedRequest.passportPhotoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline bg-blue-50 p-2 rounded">
                            <CheckCircle className="w-4 h-4 text-emerald-500"/> {L('Passport Photo', 'صورة شخصية')}
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-50 p-2 rounded">
                            <XCircle className="w-4 h-4"/> {L('Passport Photo', 'صورة شخصية')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4 border-t border-slate-200">
                  <Button variant="outline" className={`text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 ${canDecline ? '' : 'invisible'}`}
                    onClick={() => {
                      const reason = prompt('Reason for declining this application (Optional):')
                      if (reason !== null) {
                        declineMutation.mutate({ id: selectedRequest.id, reason })
                      }
                    }}
                    disabled={approveMutation.isPending || declineMutation.isPending}
                  >
                    {declineMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />} {L('Decline', 'رفض')}
                  </Button>
                  <Button variant="outline" onClick={closeReviewDialog} disabled={approveMutation.isPending}>{L('Cancel', 'إلغاء')}</Button>
                </div>
              </TabsContent>

              {/* TAB 2: ASSIGN AND APPROVE */}
              <TabsContent value="assign" className="space-y-6 py-4 outline-none">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-blue-900 font-semibold">{L('1. Branch *', '1. الفرع *')}</Label>
                      <Select value={campusId} onValueChange={(val) => { setCampusId(val); setClassId(''); setClassSectionId('') }}>
                        <SelectTrigger>
                          <SelectValue placeholder={L('Select Campus', 'اختار الفرع')} />
                        </SelectTrigger>
                        <SelectContent>
                          {campuses.map((c: any) => (
                            <SelectItem key={c.id} value={c.id} disabled={campusOptionDisabled(c)}>
                              {campusLabel(c)}
                                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-gray-500">{campusSelectionHint}</p>
                    </div>

                  </div>

                  {/* Batch, performance house and legacy class are switched off for TechNova (2026-10-03). */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-blue-900 font-semibold">{L('2. Class Mode *', '2. طريقة الحضور *')}</Label>
                      <Select value={deliveryMode} onValueChange={(v) => setDeliveryMode(v as typeof deliveryMode)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PHYSICAL">{L('Physical (On-campus)', 'حضوري (في الفرع)')}</SelectItem>
                          <SelectItem value="ONLINE">{L('Online', 'أونلاين')}</SelectItem>
                          <SelectItem value="HYBRID">{L('Hybrid', 'مختلط')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{L('3. Group (optional)', '3. الجروب (اختياري)')}</Label>
                    <Select value={classSectionId} onValueChange={setClassSectionId} disabled={!campusId}>
                      <SelectTrigger>
                        <SelectValue placeholder={L('Optional — or add the student to a group later', 'اختياري — أو ضيف الطالب لجروب بعدين')} />
                      </SelectTrigger>
                      <SelectContent>
                        {classSections.map((s: { id: string; className: string; sectionName: string; shift?: { name: string }; deliveryMode: string }) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.className}-{s.sectionName} · {s.deliveryMode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 2026-10-23 (live test, owner): the old template's roll number / class / hand-typed fees are gone — the
                      registration number is the ID, and invoices come from the level price + extra fees when the
                      student joins a group (the typed fees never made an invoice). */}
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                    {L('Invoices are made automatically: the level price when the student joins a group, plus any required extra fees (e.g. registration). Nothing to type here.',
                      'الفواتير بتتعمل لوحدها: سعر المستوى لما الطالب يدخل جروب، والرسوم الإضافية الإجبارية (زي رسوم التسجيل). مفيش حاجة تتكتب هنا.')}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-3 rounded-md text-xs text-amber-800 mt-6">
                  <span className="font-bold">{L('Note:', 'ملاحظة:')}</span> {L('Approving immediately creates the student profile and registration number. Then add the student to a group (Groups page) and give the parent portal access from the student page.', 'الموافقة بتعمل ملف الطالب ورقم القيد على طول. بعدها ضيف الطالب لجروب (صفحة الجروبات) وادّي ولي الأمر دخول البوابة من صفحة الطالب.')}
                </div>

                <DialogFooter className="mt-6 pt-4 border-t border-gray-100 flex justify-between sm:justify-between items-center w-full">
                  <Button variant="outline" onClick={closeReviewDialog} disabled={approveMutation.isPending}>{L('Cancel', 'إلغاء')}</Button>
                  {!canApprove && <p className="text-xs text-amber-700">{L('Approving needs the “approve” permission for registrations — ask the manager (Settings → Permissions).', 'الموافقة محتاجة صلاحية «موافقة» على التسجيل — كلّم المدير (الإعدادات ← الصلاحيات).')}</p>}
                  <Button
                    onClick={handleApprove}
                    disabled={approveMutation.isPending || declineMutation.isPending || !campusId /* batches are off: the server picks the branch's default batch */}
                    className={`bg-green-600 hover:bg-green-700 text-white min-w-[150px] ${canApprove ? '' : 'hidden'}`}
                  >
                    {approveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {L('Approving...', 'بيوافق...')}</> : <><CheckCircle className="w-4 h-4 mr-2" /> {L('Approve & Enrol', 'وافق وسجّل')}</>}
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation Modal */}
      <Dialog open={!!requestToDelete} onOpenChange={(open) => !open && setRequestToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" /> {L('Confirm Deletion', 'تأكيد المسح')}
            </DialogTitle>
            <DialogDescription className="py-2">
              {L('Are you sure you want to delete the admission request for', 'متأكد إنك عايز تمسح طلب التسجيل بتاع')} <span className="font-bold text-gray-900">{requestToDelete?.firstName} {requestToDelete?.lastName}</span>?
              <br /><br />
              {L('This action is permanent and will remove all associated application data.', 'المسح نهائي وهيشيل كل بيانات الطلب.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRequestToDelete(null)} disabled={deleteMutation.isPending}>
              {L('Cancel', 'إلغاء')}
            </Button>
            <Button
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => requestToDelete && deleteMutation.mutate(requestToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {L('Delete Request', 'امسح الطلب')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
