'use client'

import { GroupRulesPreview } from '@/components/rules/GroupRulesPreview'
import { useEffect, useState } from 'react'
import NextImage from 'next/image'
import { useRouter } from 'next/navigation'
import { notify } from '@/lib/notify'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { fetchApi, ApiError } from '@/lib/api-client'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { createStudentSchema, CreateStudentInput } from '@/lib/validation/student'
import type { z } from 'zod'
import type { SessionShift } from '@/lib/validation/shift'
import { MARKETING_SOURCES, optLabel } from '@/app/admissions/apply/_components'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft, AlertCircle, Loader2, UserPlus, Info } from 'lucide-react'
import Link from 'next/link'
import { DateInput } from '@/components/ui/date-input'
import { campusLabel } from '@/lib/places/label'
import { L, useI18n } from '@/lib/i18n/client'

type Campus = { id: string; name: string }
type SectionData = {
  id: string
  className: string
  sectionName: string
  shift: { code: SessionShift; name: string }
  _count?: { enrollments: number }
}

type QueryResult<T> = T | { data?: T }
type CreateStudentFormValues = z.input<typeof createStudentSchema>

// ─── Field Error Helper ───────────────────────────────────────────────────────
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="flex items-center gap-1 text-xs text-destructive mt-1">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {message}
    </p>
  )
}

// ─── Required Label Helper ────────────────────────────────────────────────────
function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label>
      {children} <span className="text-destructive">*</span>
    </Label>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdmissionPage() {
  useI18n() // re-render on a language switch
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [serverErrors, setServerErrors] = useState<{ field: string; message: string }[]>([])
  const [enrollmentStatus, setEnrollmentStatus] = useState<'none' | 'enrolled' | 'skipped'>('none')
  // Change 1: global client-side validation error summary
  const [validationErrors, setValidationErrors] = useState<{ field: string; label: string }[]>([])

  const {
    register,
    handleSubmit,
    setValue,
    control,
    setError,
    formState: { errors },
  } = useForm<CreateStudentFormValues, unknown, CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      nationality: 'Egyptian',
      academicYear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
      totalFeeAmount: 0, // WHY 0: Fees are set by the Super Admin — no hardcoded defaults
      parentStatus: 'BOTH_ALIVE',
    },
  })

  const selectedCampusId = useWatch({ control, name: 'campusId' })
  const selectedSectionId = useWatch({ control, name: 'classSectionId' })
  // Partners part 1-B2: "New admission" from a place / partner page → that place chosen
  useEffect(() => {
    const campusId = new URLSearchParams(window.location.search).get('campusId')
    if (campusId) setValue('campusId', campusId)
  }, [setValue])
  const hasSiblingAtAcademy = useWatch({ control, name: 'hasSiblingAtAcademy' })

  // ── Data Fetching ────────────────────────────────────────────────────────
  const { data: campusesRaw } = useQuery<QueryResult<Campus[]>>({
    queryKey: ['campuses'],
    queryFn: () => fetchApi<Campus[]>('/api/campuses'),
  })
  const campuses = Array.isArray(campusesRaw) ? campusesRaw : campusesRaw?.data || []

  const { data: sectionsRaw, isLoading: sectionsLoading } = useQuery<QueryResult<SectionData[]>>({
    queryKey: ['admission-sections', selectedCampusId],
    queryFn: () => {
      const p = new URLSearchParams()
      if (selectedCampusId) p.set('campusId', selectedCampusId)
      return fetchApi<SectionData[]>(`/api/class-sections?${p}`)
    },
    enabled: !!selectedCampusId,
  })

  const sections = Array.isArray(sectionsRaw) ? sectionsRaw : sectionsRaw?.data ?? []


  // Default the academic year to the ACTIVE year in the system (not "this
  // calendar year" — in September that pointed at a year that isn't active).
  const { data: academicYearsRaw } = useQuery<QueryResult<{ name: string; isActive: boolean }[]>>({
    queryKey: ['academic-years'],
    queryFn: () => fetchApi<{ name: string; isActive: boolean }[]>('/api/academic-years'),
  })
  const academicYears = Array.isArray(academicYearsRaw) ? academicYearsRaw : academicYearsRaw?.data ?? []
  const activeYearName = academicYears.find((y) => y.isActive)?.name
  useEffect(() => {
    if (activeYearName && /^\d{4}-\d{4}$/.test(activeYearName)) setValue('academicYear', activeYearName)
  }, [activeYearName, setValue])

  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify.error(L('Please upload a valid image file', 'ارفع صورة صحيحة'))
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX = 400
        let { width, height } = img
        if (width > height) { if (width > MAX) { height *= MAX / width; width = MAX } }
        else { if (height > MAX) { width *= MAX / height; height = MAX } }
        canvas.width = width; canvas.height = height
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        setPreviewImage(dataUrl)
        setValue('profilePicture', dataUrl)
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  // ── Submit Handler ───────────────────────────────────────────────────────
  const onSubmit = async (data: CreateStudentInput) => {
    setIsLoading(true)
    setServerErrors([])
    setValidationErrors([])
    setEnrollmentStatus('none')

    try {
      const result = await fetchApi<{
        id: string
        registrationNumber: string
        enrollmentId?: string | null
        guardianId?: string | null
        enrollmentNote?: string
        guardianNote?: string
      }>('/api/students', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          dateOfBirth: new Date(data.dateOfBirth).toISOString(),
        }),
      })

      const didEnroll = !!result.enrollmentId
      setEnrollmentStatus(didEnroll ? 'enrolled' : 'skipped')

      // Primary success toast
      notify.success(L('Student admitted successfully!', 'الطالب اتسجل!'), {
        description: `${L('Registration No:', 'رقم القيد:')} ${result.registrationNumber}`,
        duration: 6000,
      })

      // Warn about partial failures (non-fatal)
      if (result.enrollmentNote) {
        notify.warning(L('Enrollment note', 'ملاحظة عن الجروب'), { description: result.enrollmentNote, duration: 8000 })
      }
      if (result.guardianNote) {
        notify.warning(L('Guardian setup note', 'ملاحظة عن ولي الأمر'), { description: result.guardianNote, duration: 8000 })
      }

      queryClient.invalidateQueries({ queryKey: ['students'] })
      router.push('/dashboard/students')
    } catch (err) {
      if (err instanceof ApiError) {
        // Map server field errors back to the form so they appear inline
        if (err.hasFieldErrors) {
          const unmapped: { field: string; message: string }[] = []

          err.fieldErrors.forEach(({ field, message }) => {
            // react-hook-form only accepts known field paths
            const knownFields: (keyof CreateStudentFormValues)[] = [
              'firstName', 'lastName', 'fullNameAr', 'fatherName', 'dateOfBirth', 'gender',
              'address', 'city', 'phoneNumber', 'emergencyContact', 'email',
              'campusId', 'batchId', 'classSectionId', 'rollNumber', 'academicYear',
              'totalFeeAmount',
              'guardianFirstName', 'guardianPhone',
              'guardianEmail', 'guardianRelationship',
            ]

            if (knownFields.includes(field as keyof CreateStudentFormValues)) {
              setError(field as keyof CreateStudentFormValues, { type: 'server', message })
            } else {
              unmapped.push({ field, message })
            }
          })

          setServerErrors(unmapped)

          notify.error(L('Please fix the highlighted fields', 'صلّح الخانات اللي متعلّم عليها'), {
            description: `${err.fieldErrors.length} validation error${err.fieldErrors.length > 1 ? 's' : ''} found`,
          })
        } else if (err.status === 409) {
          // Duplicate phone number — map to the field
          setError('phoneNumber', { type: 'server', message: err.message })
          notify.error(L('Duplicate record', 'الطالب ده متسجل قبل كده'), { description: err.message })
        } else {
          notify.error(L('Admission failed', 'التسجيل ماتمّش'), { description: err.message })
        }
      } else {
        notify.error(L('Unexpected error', 'حصل خطأ'), { description: 'Please try again or contact support.' })
      }
    } finally {
      setIsLoading(false)
    }
  }

  // CHANGE 1: Collect Zod field errors on invalid submit, show summary banner.
  // WHY: react-hook-form's second arg to handleSubmit fires when validation fails.
  // This gives the super admin a single scannable list of missing required fields.
  const FIELD_LABELS: Partial<Record<keyof CreateStudentFormValues, string>> = {
    firstName: L('First Name', 'الاسم الأول'),
    lastName: L('Last Name', 'اسم العيلة'),
    fullNameAr: L('Full Name (Arabic)', 'الاسم بالكامل (عربي)'),
    fatherName: L("Father's Name", 'اسم الأب'),
    dateOfBirth: L('Date of Birth', 'تاريخ الميلاد'),
    gender: L('Gender', 'النوع'),
    address: L('Full Address', 'العنوان'),
    city: L('City', 'المدينة'),
    phoneNumber: L('Phone Number', 'رقم التليفون'),
    emergencyContact: L('Emergency Contact', 'رقم الطوارئ'),
    campusId: L('Campus', 'الفرع'),
    batchId: L('Batch', 'الدفعة'),
    academicYear: L('Academic Year', 'السنة الدراسية'),
    totalFeeAmount: L('Total Monthly Fee Amount', 'الرسوم الشهرية'),
    rollNumber: L('Roll Number', 'رقم الطالب'),
    guardianFirstName: L('Guardian First Name', 'الاسم الأول لولي الأمر'),
    guardianPhone: L('Guardian Phone', 'تليفون ولي الأمر'),
    guardianEmail: L('Guardian Email', 'إيميل ولي الأمر'),
  }

  const onInvalid = (errors: FieldErrors<CreateStudentFormValues>) => {
    const list: { field: string; label: string }[] = []
    Object.entries(errors).forEach(([field]) => {
      list.push({
        field,
        label: FIELD_LABELS[field as keyof CreateStudentFormValues] ?? field,
      })
    })
    setValidationErrors(list)
    // Scroll to the top so the banner is immediately visible
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/students">
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{L('New Student Admission', 'تسجيل طالب جديد')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {L('Complete all required fields (', 'املا كل الخانات المطلوبة (')}<span className="text-destructive font-medium">*</span>) to admit a student. Section selection automatically creates an Academic Engine enrollment.
          </p>
        </div>
      </div>

      {/* CHANGE 1: Global client-side validation error banner — lists every missing required field */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive" id="validation-error-banner">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{L('Please complete all required fields before submitting', 'املا كل الخانات المطلوبة قبل ما تسجّل')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1 mt-2">
              {validationErrors.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold">{e.label}</span> {L('is required or invalid', 'مطلوب أو مش صحيح')}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Global server-side error banner (for non-field errors) */}
      {serverErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{L('Additional server errors', 'أخطاء تانية من السيرفر')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1 mt-1">
              {serverErrors.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium">{e.field}:</span> {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Enrollment status feedback */}
      {enrollmentStatus === 'skipped' && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{L('No section selected', 'مفيش جروب')}</AlertTitle>
          <AlertDescription>
            {L('Student was admitted without an Academic Engine enrollment. You can add one later from the student profile.', 'الطالب اتسجل من غير جروب. تقدر تضيفه لجروب بعدين من صفحته.')}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">

        {/* ── Personal Details ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{L('Personal Details', 'البيانات الشخصية')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Profile picture */}
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <div className="relative w-32 h-32 rounded-xl border-2 border-dashed border-border overflow-hidden flex items-center justify-center bg-muted flex-shrink-0 group">
                {previewImage ? (
                  <NextImage src={previewImage} alt={L('Preview', 'معاينة')} fill className="object-cover" />
                ) : (
                  <div className="text-center text-muted-foreground">
                    <UserPlus className="w-8 h-8 mx-auto mb-1 opacity-40" />
                    <span className="text-xs">{L('Upload Photo', 'ارفع صورة')}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-xs font-semibold">{L('Change', 'غيّر')}</span>
                </div>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
              <div className="flex flex-col justify-center">
                <h3 className="font-medium">{L('Student Profile Photo', 'صورة الطالب')}</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  {L('Passport-size photo recommended. Auto-compressed for ID cards and certificates.', 'صورة واضحة للوش، بتتصغّر لوحدها للكارنيه والشهادات.')}
                </p>
                <FieldError message={errors.profilePicture?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <RequiredLabel>{L('First Name', 'الاسم الأول')}</RequiredLabel>
                <Input {...register('firstName')} className={errors.firstName ? 'border-destructive focus-visible:ring-destructive' : ''} placeholder={L('e.g. Muhammad', 'مثلاً: Mohamed')} />
                <FieldError message={errors.firstName?.message} />
              </div>
              <div className="space-y-1.5">
                <RequiredLabel>{L('Last Name', 'اسم العيلة')}</RequiredLabel>
                <Input {...register('lastName')} className={errors.lastName ? 'border-destructive focus-visible:ring-destructive' : ''} placeholder={L('e.g. Ahmed', 'مثلاً: Ahmed')} />
                <FieldError message={errors.lastName?.message} />
              </div>
              <div className="space-y-1.5">
                <RequiredLabel>Father&apos;s Name</RequiredLabel>
                <Input {...register('fatherName')} className={errors.fatherName ? 'border-destructive focus-visible:ring-destructive' : ''} placeholder={L('Father\'s full name', 'اسم الأب بالكامل')} />
                <FieldError message={errors.fatherName?.message} />
              </div>
              <div className="space-y-1.5">
                <RequiredLabel>{L('Full Name (Arabic)', 'الاسم بالكامل (عربي)')}</RequiredLabel>
                <Input {...register('fullNameAr')} className={errors.fullNameAr ? 'border-destructive focus-visible:ring-destructive' : ''} placeholder="أحمد محمد علي حسن" />
                <FieldError message={errors.fullNameAr?.message} />
              </div>
              <div className="space-y-1.5">
                <Label>{L('Full Name (English)', 'الاسم بالكامل (إنجليزي)')} <span className="text-muted-foreground text-xs">{L('(for certificates)', '(للشهادات)')}</span></Label>
                <Input {...register('fullNameEn')} placeholder={L('Ahmed Mohamed Ali Hassan', 'أحمد محمد علي حسن')} />
              </div>
              <div className="space-y-1.5">
                <Label>Father&apos;s Phone</Label>
                <Input {...register('fatherPhoneNumber')} placeholder="01012345678" />
              </div>
              <div className="space-y-1.5">
                <Label>Father&apos;s Occupation</Label>
                <Input {...register('fatherOccupation')} placeholder={L('e.g. Teacher, Business', 'مثلاً: مدرس، أعمال حرة')} />
              </div>
              <div className="space-y-1.5">
                <Label>Mother&apos;s Name <span className="text-muted-foreground text-xs">{L('(optional)', '(اختياري)')}</span></Label>
                <Input {...register('motherName')} placeholder={L('Mother\'s full name', 'اسم الأم بالكامل')} />
              </div>
              <div className="space-y-1.5">
                <Label>Mother&apos;s Phone</Label>
                <Input {...register('motherPhoneNumber')} placeholder="01012345678" />
              </div>
              <div className="space-y-1.5">
                <Label>Mother&apos;s Occupation</Label>
                <Input {...register('motherOccupation')} placeholder={L('e.g. Doctor, Housewife', 'مثلاً: دكتورة، ربة منزل')} />
              </div>
              <div className="space-y-1.5">
                <Label>{L('Parent Status', 'حالة الوالدين')}</Label>
                <Select onValueChange={(val) => setValue('parentStatus', val as CreateStudentInput['parentStatus'])} defaultValue="BOTH_ALIVE">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH_ALIVE">{L('Both parents present', 'الأب والأم موجودين')}</SelectItem>
                    <SelectItem value="FATHER_DECEASED">{L('Father deceased', 'الأب متوفي')}</SelectItem>
                    <SelectItem value="MOTHER_DECEASED">{L('Mother deceased', 'الأم متوفية')}</SelectItem>
                    <SelectItem value="BOTH_DECEASED">{L('Both deceased', 'الاتنين متوفيين')}</SelectItem>
                    <SelectItem value="DIVORCED">{L('Parents divorced', 'الأب والأم منفصلين')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2 border-t pt-4 mt-2">
                <h4 className="font-semibold text-sm mb-2 text-slate-700">{L('Identity & Demographic Info', 'الميلاد والنوع')}</h4>
              </div>
              <div className="space-y-1.5">
                <RequiredLabel>{L('Date of Birth', 'تاريخ الميلاد')}</RequiredLabel>
                <DateInput {...register('dateOfBirth')} className={errors.dateOfBirth ? 'border-destructive focus-visible:ring-destructive' : ''} />
                <FieldError message={errors.dateOfBirth?.message} />
              </div>
              <div className="space-y-1.5">
                <RequiredLabel>{L('Gender', 'النوع')}</RequiredLabel>
                <Select onValueChange={(val) => setValue('gender', val as 'MALE' | 'FEMALE')}>
                  <SelectTrigger className={errors.gender ? 'border-destructive focus:ring-destructive' : ''}>
                    <SelectValue placeholder={L('Select gender', 'اختار النوع')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">{L('Male', 'ولد')}</SelectItem>
                    <SelectItem value="FEMALE">{L('Female', 'بنت')}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError message={errors.gender?.message} />
              </div>
              <div className="space-y-1.5">
                <Label>{L('Blood Group', 'فصيلة الدم')} <span className="text-muted-foreground text-xs">{L('(optional)', '(اختياري)')}</span></Label>
                <Select onValueChange={(val) => setValue('bloodGroup', val as CreateStudentInput['bloodGroup'])}>
                  <SelectTrigger><SelectValue placeholder={L('Select blood group', 'اختار الفصيلة')} /></SelectTrigger>
                  <SelectContent>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                      <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Contact & Address ── */}
        <Card>
          <CardHeader><CardTitle>{L('Contact & Address', 'التواصل والعنوان')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <RequiredLabel>{L('Full Address', 'العنوان بالتفصيل')}</RequiredLabel>
              <Input {...register('address')} placeholder={L('Street, area, locality', 'الشارع، المنطقة')} className={errors.address ? 'border-destructive focus-visible:ring-destructive' : ''} />
              <FieldError message={errors.address?.message} />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel>{L('City', 'المدينة')}</RequiredLabel>
              <Input {...register('city')} placeholder={L('e.g. Hurghada', 'مثلاً: الغردقة')} className={errors.city ? 'border-destructive focus-visible:ring-destructive' : ''} />
              <FieldError message={errors.city?.message} />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel>{L('Phone Number', 'رقم التليفون')}</RequiredLabel>
              <Input {...register('phoneNumber')} placeholder="01012345678" className={errors.phoneNumber ? 'border-destructive focus-visible:ring-destructive' : ''} />
              <FieldError message={errors.phoneNumber?.message} />
            </div>
            <div className="space-y-1.5">
              <RequiredLabel>{L('Emergency Contact', 'رقم الطوارئ')}</RequiredLabel>
              <Input {...register('emergencyContact')} placeholder="01012345678" className={errors.emergencyContact ? 'border-destructive focus-visible:ring-destructive' : ''} />
              <FieldError message={errors.emergencyContact?.message} />
            </div>
          </CardContent>
        </Card>

        {/* ── School Background ── */}
        <Card>
          <CardHeader>
            <CardTitle>{L('School Background', 'المدرسة')} <span className="text-sm font-medium text-muted-foreground">{L('(Optional)', '(اختياري)')}</span></CardTitle>
            <CardDescription>{L('Details about the student\'s regular school and any prior programming experience.', 'مدرسة الطالب وأي خبرة قبل كده في البرمجة.')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{L('Current School', 'المدرسة')}</Label>
              <Input {...register('schoolName')} placeholder={L('e.g. Al-Ahyaa Language School', 'مثلاً: مدرسة الأحياء للغات')} />
            </div>
            <div className="space-y-1.5">
              <Label>{L('School Grade', 'الصف')}</Label>
              <Input {...register('regularSchoolGrade')} placeholder="e.g. الصف الرابع الابتدائي" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{L('Prior Programming / Robotics Experience', 'خبرة قبل كده في البرمجة / الروبوتات')}</Label>
              <Input {...register('priorProgrammingExperience')} placeholder={L('e.g. Took a Scratch course before', 'مثلاً: أخد كورس Scratch قبل كده')} />
            </div>
          </CardContent>
        </Card>

        {/* ── Medical & Additional ── */}
        <Card>
          <CardHeader><CardTitle>{L('Medical & Additional Info', 'ملاحظات صحية وتانية')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label>{L('Medical Notes', 'ملاحظات صحية')} <span className="text-muted-foreground text-xs">{L('(optional — allergies, conditions staff should know about)', '(اختياري — حساسية أو أي حاجة لازم نعرفها)')}</span></Label>
              <Input {...register('medicalNotes')} placeholder={L('Optional — leave blank if none', 'اختياري — سيبه فاضي لو مفيش')} />
            </div>
            <div className="space-y-1.5 border-t pt-4 mt-2">
              <div className="flex items-center gap-2 mt-4">
                <input type="checkbox" id="hasSibling" className="w-4 h-4" {...register('hasSiblingAtAcademy')} />
                <Label htmlFor="hasSibling" className="cursor-pointer">{L('Has sibling currently studying at academy?', 'له أخ أو أخت بيدرسوا عندنا؟')}</Label>
              </div>
            </div>
            <div className="space-y-1.5 border-t pt-4 mt-2">
              <Label>{L('Sibling Name & Class', 'اسم الأخ / الأخت والجروب')}</Label>
              <div className="flex gap-2">
                <Input {...register('siblingName')} placeholder={L('Sibling Name', 'اسم الأخ / الأخت')} disabled={!hasSiblingAtAcademy} className="w-1/2" />
                <Input {...register('siblingClass')} placeholder={L('Class/Section', 'الجروب')} disabled={!hasSiblingAtAcademy} className="w-1/2" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Academic & Financial ── */}
        <Card>
          <CardHeader>
            <CardTitle>{L('Academic & Financial Placement', 'الفرع والجروب')}</CardTitle>
            <CardDescription>
              {L('Choose the branch. You can pick a group now, or add the student to a group later from the Groups page.', 'اختار الفرع. تقدر تختار الجروب دلوقتي أو تضيفه لجروب بعدين من صفحة الجروبات.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Campus */}
            <div className="space-y-1.5">
              <RequiredLabel>{L('Campus', 'الفرع')}</RequiredLabel>
              <Select
                onValueChange={(val) => { setValue('campusId', val); setValue('classSectionId', '') }}
              >
                <SelectTrigger className={errors.campusId ? 'border-destructive focus:ring-destructive' : ''}>
                  <SelectValue placeholder={L('Select campus', 'اختار الفرع')} />
                </SelectTrigger>
                <SelectContent>
                  {campuses.map((c: Campus) => (
                    <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.campusId?.message} />
            </div>

            {/* Class Section — full width */}
            <div className="space-y-1.5 md:col-span-2">
              <Label>
                {L('Group', 'الجروب')} <span className="text-muted-foreground text-xs">{L('(optional — you can also add the student to a group later)', '(اختياري — تقدر تضيفه لجروب بعدين)')}</span>
              </Label>
              <Select
                disabled={!selectedCampusId || sectionsLoading}
                onValueChange={(val) => {
                  setValue('classSectionId', val)
                  const sec = sections.find((s: SectionData) => s.id === val)
                  if (sec) setValue('shift', sec.shift.code)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !selectedCampusId ? L('Select the branch first', 'اختار الفرع الأول') :
                    sectionsLoading ? L('Loading groups…', 'بيحمّل الجروبات…') :
                    sections.length === 0 ? L('No groups found for this branch', 'مفيش جروبات في الفرع ده') :
                    L('Select a group', 'اختار جروب')
                  } />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s: SectionData) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-medium">{s.className}-{s.sectionName}</span>
                      {s._count?.enrollments !== undefined && (
                        <span className="text-muted-foreground ml-2 text-xs">({s._count.enrollments} {L('students)', 'طالب)')}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typeof selectedSectionId === 'string' && selectedSectionId && <GroupRulesPreview groupId={selectedSectionId} />}
              {selectedCampusId && sections.length === 0 && !sectionsLoading && (
                <p className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                  <Info className="w-3 h-3" />
                  {L('No active class sections found. Create sections in Academic Engine first, or admit without a section.', 'مفيش جروبات شغالة في الفرع ده. اعمل جروب الأول أو سجّل الطالب من غير جروب.')}
                </p>
              )}
            </div>

            {/* Roll Number — required only if section selected */}
            <div className="space-y-1.5">
              <Label>
                {L('Roll Number', 'رقم الطالب')} <span className="text-muted-foreground text-xs ml-1">{L('(optional — the registration number is used if empty)', '(اختياري — لو فاضي بيتاخد رقم القيد)')}</span>
              </Label>
              <Input
                {...register('rollNumber')}
                placeholder={L('e.g. 9321', 'مثلاً: 9321')}
                className={errors.rollNumber ? 'border-destructive focus-visible:ring-destructive' : ''}
              />
              <FieldError message={errors.rollNumber?.message} />
            </div>

            {/* Session shift is switched off for TechNova (2026-10-03): set from the group when one is chosen. */}

            {/* Academic year: not used by TechNova — kept internally, hidden (owner, 2026-09-29) */}
            <div className="hidden">
              <RequiredLabel>{L('Academic Year (YYYY-YYYY)', 'السنة الدراسية (YYYY-YYYY)')}</RequiredLabel>
              <Input
                {...register('academicYear')}
                placeholder="2026-2027"
                className={errors.academicYear ? 'border-destructive focus-visible:ring-destructive font-mono' : 'font-mono'}
              />
              <FieldError message={errors.academicYear?.message} />
            </div>

            {/* 2026-10-23 (live test, owner): the old "Total Monthly Fee Amount" was typed by hand and never made an
                invoice — invoices come from the group's level price + required extra fees. Kept as a hidden 0. */}
            <input type="hidden" {...register('totalFeeAmount', { valueAsNumber: true })} />
            <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
              {L('Invoices are made automatically: the level price when the student joins a group, plus any required extra fees (e.g. registration). Nothing to type here.',
                'الفواتير بتتعمل لوحدها: سعر المستوى لما الطالب يدخل جروب، والرسوم الإضافية الإجبارية (زي رسوم التسجيل). مفيش حاجة تتكتب هنا.')}
            </div>
          </CardContent>
        </Card>

        {/* ── Guardian / Parent ── */}
        <Card>
          <CardHeader>
            <CardTitle>{L('Guardian / Parent', 'ولي الأمر')}</CardTitle>
            <CardDescription>
              {L('Optional. Creates the parent\'s portal account. The parent signs in with this phone number after staff issue a temporary password (Credential Management).', 'اختياري. بيعمل حساب لولي الأمر على البوابة. بيدخل برقم التليفون ده بعد ما تديله باسورد مؤقت (إدارة بيانات الدخول).')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{L('Guardian First Name', 'الاسم الأول لولي الأمر')}</Label>
              <Input {...register('guardianFirstName')} placeholder={L('e.g. Mohamed', 'مثلاً: محمد')} />
              <FieldError message={errors.guardianFirstName?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>{L('Guardian Last Name', 'اسم العيلة لولي الأمر')}</Label>
              <Input {...register('guardianLastName')} placeholder={L('e.g. Amer', 'مثلاً: عامر')} />
            </div>
            <div className="space-y-1.5">
              <Label>{L('Guardian Phone', 'تليفون ولي الأمر')}</Label>
              <Input {...register('guardianPhone')} placeholder="01012345678" />
            </div>
            <div className="space-y-1.5">
              <Label>{L('Guardian Email', 'إيميل ولي الأمر')} <span className="text-muted-foreground text-xs">{L('(for portal login)', '(للدخول على البوابة)')}</span></Label>
              <Input type="email" {...register('guardianEmail')} placeholder="guardian@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>{L('Relationship', 'صلة القرابة')}</Label>
              <Input {...register('guardianRelationship')} placeholder={L('Father / Mother / Guardian', 'الأب / الأم / وصي')} />
            </div>
          </CardContent>
        </Card>

        {/* ── Marketing ── */}
        <Card>
          <CardHeader>
            <CardTitle>{L('Additional Information', 'معلومات تانية')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{L('How did you come to know about us?', 'عرفونا منين؟')}</Label>
              <Select onValueChange={(val) => setValue('sourceOfInfo', val)}>
                <SelectTrigger><SelectValue placeholder={L('Select Source', 'اختار')} /></SelectTrigger>
                <SelectContent>
                  {MARKETING_SOURCES.map(m => <SelectItem key={m} value={m}>{optLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Referral code or referring parent&apos;s phone (optional)</Label>
              <Input {...register('referralCode')} placeholder={L('TN-REF-… or 01…', 'TN-REF-… أو 01…')} />
              <p className="text-xs text-muted-foreground">{L('The parent who recommended TechNova gets their referral reward when this student pays the first invoice.', 'ولي الأمر اللي رشّحنا بياخد مكافأة الترشيح أول ما الطالب ده يدفع أول فاتورة.')}</p>
            </div>
          </CardContent>
        </Card>

        {/* ── Submit ── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground order-2 sm:order-1">
            {L('Fields marked', 'الخانات اللي عليها')} <span className="text-destructive font-bold">*</span> {L('are required. Student login credentials are auto-generated.', 'مطلوبة. بيانات دخول الطالب بتتعمل لوحدها.')}
          </p>
          <Button
            type="submit"
            disabled={isLoading}
            size="lg"
            className="w-full sm:w-auto order-1 sm:order-2 min-w-[220px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {L('Submitting admission…', 'بيسجّل…')}
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                {L('Admit Student to Academy', 'سجّل الطالب')}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
