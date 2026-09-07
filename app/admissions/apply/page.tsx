'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { AcademyLogo } from '@/components/AcademyLogo'
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck, Loader2, Home, Sparkles } from 'lucide-react'
import { notify } from '@/lib/notify'
// WHY removed react-hot-toast: The project uses `notify` (wrapping sonner) as the
// single notification façade. Mixing two toast libraries causes ID type mismatches
// and duplicate toast rendering. See lib/notify.ts for the unified API.
import imageCompression from 'browser-image-compression'
import { FL, FRow, FGroup, FieldError, SectionTitle, STEP_META, ADMISSION_RULES, FATHER_OCCUPATIONS, RELATIONSHIPS, BLOOD_GROUPS, PARENT_STATUSES, MARKETING_SOURCES, DELIVERY_MODES } from './_components'
import { SESSION_SHIFT_LABELS, type SessionShift } from '@/lib/validation/shift'
import Link from 'next/link'

type ApiFieldError = { field: string; message: string }

const INITIAL_ADMISSION_FORM_DATA = {
  preferredCampusId: '', preferredBatchId: '', preferredShift: '', deliveryMode: 'PHYSICAL',
  firstName: '', lastName: '', fullNameAr: '', fullNameEn: '', fatherName: '', motherName: '', dateOfBirth: '',
  gender: '', bloodGroup: '', nationality: 'Egyptian',
  address: '', city: '', phoneNumber: '', emergencyContact: '', email: '',
  schoolName: '', regularSchoolGrade: '', priorProgrammingExperience: '',
  guardianFirstName: '', guardianLastName: '', guardianPhoneNumber: '', guardianEmail: '', guardianRelationship: '',
  fatherPhoneNumber: '', fatherOccupation: '', motherPhoneNumber: '', motherOccupation: '', parentStatus: 'BOTH_ALIVE',
  passportPhotoBase64: '',
  medicalNotes: '', hasSiblingAtAcademy: false, siblingName: '', siblingClass: '',
  sourceOfInfo: '', termsAccepted: false,
}

type AdmissionFormData = typeof INITIAL_ADMISSION_FORM_DATA

export default function AdmissionFormPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<AdmissionFormData>(INITIAL_ADMISSION_FORM_DATA)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target as HTMLInputElement
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const handleSelect = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) return notify.error("Only JPG, PNG or WEBP images allowed.")
    if (file.size > 5 * 1024 * 1024) return notify.error("Image must be smaller than 5MB.")

    const toastId = notify.loading("Processing image...")
    try {
      const options = { maxSizeMB: 0.5, maxWidthOrHeight: fieldName === 'passportPhotoBase64' ? 800 : 1600, useWebWorker: true }
      const compressedFile = await imageCompression(file, options)
      const reader = new FileReader()
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, [fieldName]: reader.result as string }))
        notify.success("Image attached", { id: toastId })
        if (errors[fieldName]) setErrors(prev => ({ ...prev, [fieldName]: '' }))
      }
      reader.readAsDataURL(compressedFile)
    } catch {
      notify.error("Failed to process image.", { id: toastId })
    }
  }

  const validateStep = (currentStep: number) => {
    const newErrors: Record<string, string> = {}
    if (currentStep === 2) {
      if (!formData.firstName || formData.firstName.length < 2) newErrors.firstName = 'First name required (min 2)'
      if (!formData.lastName || formData.lastName.length < 2) newErrors.lastName = 'Last name required (min 2)'
      if (!formData.fullNameAr || formData.fullNameAr.length < 5) newErrors.fullNameAr = 'Full Arabic name required'
      if (!formData.fatherName || formData.fatherName.length < 2) newErrors.fatherName = 'Father name required'
      if (!formData.dateOfBirth) newErrors.dateOfBirth = 'Date of birth required'
      if (!formData.gender) newErrors.gender = 'Gender required'
      if (!formData.address || formData.address.length < 5) newErrors.address = 'Full address required'
      if (!formData.city) newErrors.city = 'City required'
      if (!formData.phoneNumber || formData.phoneNumber.length < 10) newErrors.phoneNumber = 'Valid phone required'
      if (!formData.emergencyContact || formData.emergencyContact.length < 10) newErrors.emergencyContact = 'Valid emergency contact required'
    } else if (currentStep === 3) {
      if (!formData.passportPhotoBase64) newErrors.passportPhotoBase64 = 'Passport photo is required'
    } else if (currentStep === 4) {
      if (!formData.guardianFirstName) newErrors.guardianFirstName = 'Guardian first name required'
      if (!formData.guardianLastName) newErrors.guardianLastName = 'Guardian last name required'
      if (!formData.guardianPhoneNumber) newErrors.guardianPhoneNumber = 'Guardian phone required'
      if (!formData.guardianRelationship) newErrors.guardianRelationship = 'Relationship required'
    } else if (currentStep === 5) {
      if (!formData.termsAccepted) newErrors.termsAccepted = 'You must accept the terms and conditions'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const totalSteps = STEP_META.length

  const handleNext = () => {
    if (!validateStep(step)) return
    setStep(prev => Math.min(prev + 1, totalSteps))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handlePrev = () => {
    setStep(prev => Math.max(prev - 1, 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const validateAllSteps = () => {
    for (let currentStep = 1; currentStep <= totalSteps; currentStep += 1) {
      if (!validateStep(currentStep)) {
        setStep(currentStep)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return false
      }
    }
    return true
  }

  const handleSubmit = async () => {
    if (!validateAllSteps()) return
    setIsSubmitting(true)
    const toastId = notify.loading("Submitting your application...")
    try {
      const res = await fetch('/api/admissions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      const data = await res.json()
      if (data.success) {
        notify.success("Application submitted successfully! Returning to landing page.", { id: toastId, duration: 5000 })
        setTimeout(() => router.push('/'), 600)
      } else {
        notify.error(data.error || "Submission failed", { id: toastId })
        if (data.fieldErrors) {
          const apiErrs: Record<string, string> = {}
          data.fieldErrors.forEach((fe: ApiFieldError) => { apiErrs[fe.field] = fe.message })
          setErrors(apiErrs)
          // Jump to first step with error
          const stepMap: Record<string, number> = {
            preferredCampusId: 1,
            fullNameAr: 2,
            fatherName: 2,
            schoolName: 3,
            regularSchoolGrade: 3,
            priorProgrammingExperience: 3,
            passportPhotoBase64: 3,
            guardianFirstName: 4,
            guardianLastName: 4,
            guardianPhoneNumber: 4,
            guardianRelationship: 4,
            termsAccepted: 5,
          }
          const firstErrField = Object.keys(apiErrs)[0]
          const firstErrBase = firstErrField?.split('.')[0]
          if (firstErrBase && stepMap[firstErrBase]) setStep(stepMap[firstErrBase])
        }
      }
    } catch {
      notify.error("Network error. Please try again.", { id: toastId })
    } finally {
      setIsSubmitting(false)
    }
  }

  const progressPct = Math.round((step / STEP_META.length) * 100)

  return (
    <div className="min-h-screen flex flex-col items-center pb-24" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 30%, #f1f5f9 60%, #eff6ff 100%)' }}>
      {/* ── Branded Header Bar ── */}
      <div className="w-full" style={{ background: 'linear-gradient(135deg, #1B4F8A 0%, #1e3a5f 50%, #1B4F8A 100%)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-white/90 hover:text-white transition-colors group">
            <Home className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-sm font-medium hidden sm:inline">Back to Home</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white/15 p-2 backdrop-blur-sm">
              <AcademyLogo variant="primary" className="h-8 w-8 text-white" />
            </div>
            <div className="text-right">
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">Evershine Academy</h1>
              <p className="text-[11px] text-blue-200 font-medium tracking-widest uppercase">Admission Application</p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-4xl px-4 sm:px-6 pt-6">
        {/* ── Desktop Stepper ── */}
        <div className="hidden md:block mb-8">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-lg overflow-hidden">
            {/* Global progress bar */}
            <div className="h-1 bg-slate-100 w-full">
              <motion.div className="h-full rounded-r-full" style={{ background: 'linear-gradient(90deg, #1B4F8A, #3b82f6, #6366f1)' }} initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} />
            </div>
            <div className="px-4 sm:px-8 py-6">
              <div className="flex items-start justify-between relative">
                {/* Connecting line */}
                <div className="absolute top-5 left-[8%] right-[8%] h-[2px] bg-slate-200 z-0" />
                <div className="absolute top-5 left-[8%] h-[2px] z-0 transition-all duration-500" style={{ width: `${Math.max(0, ((step - 1) / (STEP_META.length - 1)) * 84)}%`, background: 'linear-gradient(90deg, #1B4F8A, #3b82f6)' }} />
                {STEP_META.map((meta, idx) => {
                  const s = idx + 1
                  const isCompleted = step > s
                  const isCurrent = step === s
                  const StepIcon = meta.icon
                  return (
                    <div key={s} className="flex flex-col items-center text-center relative z-10" style={{ width: `${100 / STEP_META.length}%` }}>
                      <motion.div
                        initial={false}
                        animate={{ scale: isCurrent ? 1.1 : 1 }}
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm transition-all duration-300 ${
                          isCompleted
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200'
                            : isCurrent
                              ? 'text-white shadow-lg shadow-blue-300/50'
                              : 'bg-slate-100 text-slate-400 border border-slate-200'
                        }`}
                        style={isCurrent ? { background: 'linear-gradient(135deg, #1B4F8A, #3b82f6)' } : undefined}
                      >
                        {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                      </motion.div>
                      <p className={`mt-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] leading-tight ${
                        isCurrent ? 'text-blue-700' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                      }`}>{meta.label}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          {/* Step description */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 backdrop-blur-sm px-6 py-4 shadow-sm">
            <div>
              <p className="text-xs font-bold text-blue-600 uppercase tracking-[0.2em]">Step {step} of {STEP_META.length}</p>
              <p className="text-sm text-slate-600 mt-0.5">{STEP_META[step - 1].desc}</p>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-bold text-slate-700">{progressPct}%</span>
            </div>
          </div>
        </div>

        {/* ── Mobile Stepper ── */}
        <div className="md:hidden mb-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden">
            <div className="h-1 bg-slate-100">
              <div className="h-full rounded-r-full transition-all duration-500" style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #1B4F8A, #3b82f6)' }} />
            </div>
            <div className="px-4 py-3.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Step {step} / {STEP_META.length}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{STEP_META[step - 1].label}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {STEP_META.map((_, i) => (
                  <div key={i} className={`rounded-full transition-all duration-300 ${i + 1 === step ? 'w-5 h-2 bg-blue-600' : i + 1 < step ? 'w-2 h-2 bg-emerald-400' : 'w-2 h-2 bg-slate-200'}`} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Form Card ── */}
        <Card className="shadow-xl border border-slate-200/70 overflow-hidden bg-white">
          <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #1B4F8A 0%, #3b82f6 40%, #F5A623 100%)' }} />
          <CardContent className="p-6 sm:p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {step === 1 && (
                  <div className="space-y-6">
                    <SectionTitle>Program Preferences</SectionTitle>

                    {/* Delivery Mode & Preferred Shift */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FGroup>
                        <FL>Preferred Delivery Mode</FL>
                        <Select value={formData.deliveryMode} onValueChange={(val) => handleSelect('deliveryMode', val)}>
                          <SelectTrigger><SelectValue placeholder="Select delivery mode" /></SelectTrigger>
                          <SelectContent>
                            {DELIVERY_MODES.map((mode) => (
                              <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FGroup>

                      <FGroup>
                        <FL>Preferred Shift</FL>
                        <Select value={formData.preferredShift} onValueChange={(val) => handleSelect('preferredShift', val)}>
                          <SelectTrigger><SelectValue placeholder="Select preferred shift" /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(SESSION_SHIFT_LABELS) as SessionShift[]).map((code) => (
                              <SelectItem key={code} value={code}>{SESSION_SHIFT_LABELS[code]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FGroup>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 shadow-sm">
                      <div className="font-semibold text-slate-900">Program preferences will be verified by the admissions office</div>
                      <p className="mt-1 text-slate-500">The exact course, level, and group will be confirmed by the admissions team after review.</p>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6">
                    <SectionTitle>Student Details & Contact</SectionTitle>
                    <FRow>
                      <FGroup>
                        <FL required>First Name (English)</FL>
                        <Input name="firstName" value={formData.firstName} onChange={handleChange} />
                        <FieldError message={errors.firstName} />
                      </FGroup>
                      <FGroup>
                        <FL required>Last Name (English)</FL>
                        <Input name="lastName" value={formData.lastName} onChange={handleChange} />
                        <FieldError message={errors.lastName} />
                      </FGroup>
                      <FGroup full>
                        <FL required>Full Name (Arabic)</FL>
                        <Input name="fullNameAr" value={formData.fullNameAr} onChange={handleChange} placeholder="أحمد محمد علي حسن" />
                        <FieldError message={errors.fullNameAr} />
                      </FGroup>
                      <FGroup full>
                        <FL>Full Name (English, for certificates)</FL>
                        <Input name="fullNameEn" value={formData.fullNameEn} onChange={handleChange} placeholder="Ahmed Mohamed Ali Hassan" />
                      </FGroup>
                      <FGroup>
                        <FL required>Father&apos;s Name</FL>
                        <Input name="fatherName" value={formData.fatherName} onChange={handleChange} />
                        <FieldError message={errors.fatherName} />
                      </FGroup>
                      <FGroup>
                        <FL>Father&apos;s Phone</FL>
                        <Input name="fatherPhoneNumber" value={formData.fatherPhoneNumber} onChange={handleChange} placeholder="+201234567890" />
                      </FGroup>
                      <FGroup>
                        <FL>Father&apos;s Occupation</FL>
                        <Select value={formData.fatherOccupation} onValueChange={(val) => handleSelect('fatherOccupation', val)}>
                          <SelectTrigger><SelectValue placeholder="Select occupation" /></SelectTrigger>
                          <SelectContent>
                            {FATHER_OCCUPATIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FGroup>
                      <FGroup>
                        <FL>Mother&apos;s Name</FL>
                        <Input name="motherName" value={formData.motherName} onChange={handleChange} />
                      </FGroup>
                      <FGroup>
                        <FL>Mother&apos;s Phone</FL>
                        <Input name="motherPhoneNumber" value={formData.motherPhoneNumber} onChange={handleChange} placeholder="+201234567890" />
                      </FGroup>
                      <FGroup>
                        <FL>Mother&apos;s Occupation</FL>
                        <Input name="motherOccupation" value={formData.motherOccupation} onChange={handleChange} placeholder="e.g. Doctor, Housewife" />
                      </FGroup>
                      <FGroup>
                        <FL>Parent Status</FL>
                        <Select value={formData.parentStatus} onValueChange={(val) => handleSelect('parentStatus', val)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PARENT_STATUSES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FGroup>
                      <FGroup>
                        <FL required>Date of Birth</FL>
                        <Input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} />
                        <FieldError message={errors.dateOfBirth} />
                      </FGroup>
                      <FGroup>
                        <FL required>Gender</FL>
                        <Select value={formData.gender} onValueChange={(val) => handleSelect('gender', val)}>
                          <SelectTrigger><SelectValue placeholder="Select Gender" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MALE">Male</SelectItem>
                            <SelectItem value="FEMALE">Female</SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldError message={errors.gender} />
                      </FGroup>
                      <FGroup>
                        <FL>Blood Group</FL>
                        <Select value={formData.bloodGroup} onValueChange={(val) => handleSelect('bloodGroup', val)}>
                          <SelectTrigger><SelectValue placeholder="Select Blood Group" /></SelectTrigger>
                          <SelectContent>
                            {BLOOD_GROUPS.map(group => <SelectItem key={group} value={group}>{group}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FGroup>
                      <FGroup>
                        <FL>Nationality</FL>
                        <Input name="nationality" value={formData.nationality} onChange={handleChange} />
                      </FGroup>
                    </FRow>

                    <div className="border-t border-slate-200 pt-6">
                      <SectionTitle>Contact Information</SectionTitle>
                      <FGroup full>
                        <FL required>Complete Residential Address</FL>
                        <Textarea name="address" value={formData.address} onChange={handleChange} placeholder="Street, area, landmark..." rows={3} />
                        <FieldError message={errors.address} />
                      </FGroup>
                      <FRow>
                        <FGroup>
                          <FL required>City</FL>
                          <Input name="city" value={formData.city} onChange={handleChange} placeholder="e.g. Hurghada" />
                          <FieldError message={errors.city} />
                        </FGroup>
                        <FGroup>
                          <FL>Email Address (Optional)</FL>
                          <Input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="student@example.com" />
                          <FieldError message={errors.email} />
                        </FGroup>
                        <FGroup>
                          <FL required>Primary Phone Number</FL>
                          <Input name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} placeholder="+201234567890" />
                          <FieldError message={errors.phoneNumber} />
                        </FGroup>
                        <FGroup>
                          <FL required>Emergency Contact (Different from Primary)</FL>
                          <Input name="emergencyContact" value={formData.emergencyContact} onChange={handleChange} placeholder="+201234567890" />
                          <FieldError message={errors.emergencyContact} />
                        </FGroup>
                      </FRow>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-6">
                    <SectionTitle>School Background (Optional)</SectionTitle>
                    <FRow>
                      <FGroup>
                        <FL>Current School</FL>
                        <Input name="schoolName" value={formData.schoolName} onChange={handleChange} placeholder="e.g. Al-Ahyaa Language School" />
                      </FGroup>
                      <FGroup>
                        <FL>School Grade</FL>
                        <Input name="regularSchoolGrade" value={formData.regularSchoolGrade} onChange={handleChange} placeholder="e.g. الصف الرابع الابتدائي" />
                      </FGroup>
                      <FGroup full>
                        <FL>Prior Programming / Robotics Experience</FL>
                        <Input name="priorProgrammingExperience" value={formData.priorProgrammingExperience} onChange={handleChange} placeholder="e.g. Took a Scratch course before" />
                      </FGroup>
                    </FRow>

                    <div className="mt-6 border-t border-slate-200 pt-6">
                      <SectionTitle>Document Upload</SectionTitle>
                      <div className={`p-4 border rounded-xl ${errors.passportPhotoBase64 ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <FL required>Passport Size Photograph</FL>
                            <p className="text-xs text-slate-500 mt-1">Recent photo, plain background. Max 5MB.</p>
                          </div>
                          {formData.passportPhotoBase64 && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                        </div>
                        <div className="flex items-center gap-4">
                          {formData.passportPhotoBase64 && (
                            <div className="w-16 h-16 rounded overflow-hidden border border-slate-200 shrink-0 relative">
                              <Image src={formData.passportPhotoBase64} alt="Preview" fill className="object-cover" />
                            </div>
                          )}
                          <div className="flex-1">
                            <Input type="file" accept="image/jpeg, image/png, image/webp" onChange={(e) => handleFileUpload(e, 'passportPhotoBase64')} className="cursor-pointer file:cursor-pointer" />
                          </div>
                        </div>
                        <FieldError message={errors.passportPhotoBase64} />
                      </div>
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-6">
                    <SectionTitle>Guardian Information</SectionTitle>
                    <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 mb-6">
                      <p className="text-sm text-blue-800">
                        The guardian is the person legally and financially responsible for the student. An academy portal account may be created using these details.
                      </p>
                    </div>
                    <FRow>
                      <FGroup>
                        <FL required>Guardian First Name</FL>
                        <Input name="guardianFirstName" value={formData.guardianFirstName} onChange={handleChange} />
                        <FieldError message={errors.guardianFirstName} />
                      </FGroup>
                      <FGroup>
                        <FL required>Guardian Last Name</FL>
                        <Input name="guardianLastName" value={formData.guardianLastName} onChange={handleChange} />
                      </FGroup>
                      <FGroup>
                        <FL required>Relationship to Student</FL>
                        <Select value={formData.guardianRelationship} onValueChange={(val) => handleSelect('guardianRelationship', val)}>
                          <SelectTrigger><SelectValue placeholder="Select Relationship" /></SelectTrigger>
                          <SelectContent>
                            {RELATIONSHIPS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FieldError message={errors.guardianRelationship} />
                      </FGroup>
                      <FGroup>
                        <FL required>Guardian Phone</FL>
                        <Input name="guardianPhoneNumber" value={formData.guardianPhoneNumber} onChange={handleChange} />
                        <FieldError message={errors.guardianPhoneNumber} />
                      </FGroup>
                      <FGroup>
                        <FL>Guardian Email</FL>
                        <Input type="email" name="guardianEmail" value={formData.guardianEmail} onChange={handleChange} />
                      </FGroup>
                    </FRow>

                    <div className="mt-6 border-t border-slate-200 pt-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="hasSiblingAtAcademy"
                          checked={formData.hasSiblingAtAcademy}
                          onChange={(e) => setFormData(prev => ({ ...prev, hasSiblingAtAcademy: e.target.checked }))}
                          className="w-4 h-4"
                        />
                        <label htmlFor="hasSiblingAtAcademy" className="text-sm text-slate-700 cursor-pointer">Has a sibling currently studying at TechNova?</label>
                      </div>
                      {formData.hasSiblingAtAcademy && (
                        <FRow>
                          <FGroup>
                            <FL>Sibling Name</FL>
                            <Input name="siblingName" value={formData.siblingName} onChange={handleChange} />
                          </FGroup>
                          <FGroup>
                            <FL>Sibling Class/Group</FL>
                            <Input name="siblingClass" value={formData.siblingClass} onChange={handleChange} />
                          </FGroup>
                        </FRow>
                      )}
                    </div>

                    <div className="mt-6 border-t border-slate-200 pt-6">
                      <FGroup full>
                        <FL>Medical Notes <span className="text-slate-400 font-normal">(optional — allergies, conditions staff should know about)</span></FL>
                        <Input name="medicalNotes" value={formData.medicalNotes} onChange={handleChange} placeholder="Leave blank if none" />
                      </FGroup>
                    </div>
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-6">
                    <SectionTitle>Review &amp; Submit</SectionTitle>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Applicant Card */}
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b" style={{ background: 'linear-gradient(135deg, #eff6ff, #eef2ff)' }}>
                          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-600" /> Applicant
                          </h4>
                        </div>
                        <dl className="p-5 space-y-3 text-sm">
                          <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-semibold text-slate-900">{formData.firstName} {formData.lastName}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Father</dt><dd className="font-medium text-slate-800">{formData.fatherName}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">DOB</dt><dd className="font-medium text-slate-800">{formData.dateOfBirth || '—'}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="font-medium text-slate-800">{formData.phoneNumber || '—'}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">City</dt><dd className="font-medium text-slate-800">{formData.city || '—'}</dd></div>
                        </dl>
                      </div>

                      {/* Program & Guardian Card */}
                      <div className="space-y-5">
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="px-5 py-3 border-b" style={{ background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)' }}>
                            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500" /> Program
                            </h4>
                          </div>
                          <dl className="p-5 space-y-3 text-sm">
                            <div className="flex justify-between"><dt className="text-slate-500">Delivery Mode</dt><dd className="font-bold text-blue-700">{formData.deliveryMode || '—'}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Preferred Shift</dt><dd className="font-medium text-slate-800">{formData.preferredShift ? SESSION_SHIFT_LABELS[formData.preferredShift as SessionShift] : '—'}</dd></div>
                          </dl>
                        </div>
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="px-5 py-3 border-b" style={{ background: 'linear-gradient(135deg, #fefce8, #fef9c3)' }}>
                            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-amber-500" /> Guardian
                            </h4>
                          </div>
                          <dl className="p-5 space-y-3 text-sm">
                            <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-semibold text-slate-900">{formData.guardianFirstName} {formData.guardianLastName}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="font-medium text-slate-800">{formData.guardianPhoneNumber || '—'}</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500">Relation</dt><dd className="font-medium text-slate-800">{formData.guardianRelationship || '—'}</dd></div>
                          </dl>
                        </div>
                      </div>
                    </div>

                    {/* Marketing Source */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                      <SectionTitle>How Did You Come to Know about Us</SectionTitle>
                      <FGroup full>
                        <Select value={formData.sourceOfInfo} onValueChange={(val) => handleSelect('sourceOfInfo', val)}>
                          <SelectTrigger><SelectValue placeholder="Select Source" /></SelectTrigger>
                          <SelectContent>
                            {MARKETING_SOURCES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FGroup>
                    </div>

                    {/* Rules & Regulations */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #1B4F8A, #1e3a5f)' }}>
                        <ShieldCheck className="w-4 h-4 text-white" />
                        <h4 className="text-sm font-bold text-white">Rules and Regulations</h4>
                      </div>
                      <div className="p-5 max-h-52 overflow-y-auto space-y-2.5 text-[13px] text-slate-600 leading-relaxed">
                        {ADMISSION_RULES.map((rule, i) => (
                          <p key={i} className="flex gap-2">
                            <span className="text-blue-600 font-bold shrink-0">{i + 1}.</span>
                            {rule}
                          </p>
                        ))}
                      </div>
                      <div className={`mx-5 mb-5 p-4 rounded-xl flex items-start gap-3 border transition-colors ${errors.termsAccepted ? 'bg-red-50 border-red-200' : 'border-blue-200 bg-blue-50/50'}`}>
                        <Checkbox
                          id="termsAccepted"
                          checked={Boolean(formData.termsAccepted)}
                          onCheckedChange={(c) => {
                            setFormData((p) => ({...p, termsAccepted: !!c}))
                            if (errors.termsAccepted) setErrors(p => ({...p, termsAccepted: ''}))
                          }}
                          className="mt-0.5"
                        />
                        <div className="grid gap-1">
                          <label htmlFor="termsAccepted" className="text-sm font-semibold text-slate-900 cursor-pointer">
                            I accept the Rules and Regulations
                          </label>
                          <p className="text-xs text-slate-500">
                            By ticking this box, you digitally sign this admission request and bind yourself to the institutional policies of Evershine Academy.
                          </p>
                          <FieldError message={errors.termsAccepted} />
                        </div>
                      </div>
                    </div>

                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </CardContent>

          {/* Navigation Footer */}
          <div className="px-6 py-4 sm:px-8 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3" style={{ background: 'linear-gradient(180deg, #fafbfc, #f1f5f9)' }}>
            {step > 1 ? (
              <Button type="button" variant="outline" onClick={handlePrev} disabled={isSubmitting} className="w-full sm:w-auto border-slate-300 text-slate-700 hover:bg-white transition-all">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
            ) : (
              <Link href="/" className="w-full sm:w-auto">
                <Button type="button" variant="outline" className="w-full border-slate-300 text-slate-700 hover:bg-white">
                  <Home className="w-4 h-4 mr-2" /> Home
                </Button>
              </Link>
            )}

            {step < 6 ? (
              <Button type="button" onClick={handleNext} className="w-full sm:w-auto text-white shadow-lg transition-all hover:shadow-xl" style={{ background: 'linear-gradient(135deg, #1B4F8A, #3b82f6)' }}>
                Next Step <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="w-full sm:w-auto">
                <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 min-w-[180px]">
                  {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Submit Application</>}
                </Button>
              </motion.div>
            )}
          </div>
        </Card>

        {/* Footer note */}
        <div className="text-center mt-6 mb-4">
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Evershine Academy · All information is confidential and secured</p>
        </div>
      </div>
    </div>
  )
}
