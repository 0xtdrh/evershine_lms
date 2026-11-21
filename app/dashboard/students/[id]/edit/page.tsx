'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Save, Loader2, User, Phone, MapPin, Building2, Calendar, Droplets, ShieldAlert, Key } from 'lucide-react'
import Link from 'next/link'
import { notify } from '@/lib/notify'
import { DateInput } from '@/components/ui/date-input'
import { L, useI18n } from '@/lib/i18n/client'

interface StudentEditSource {
  firstName: string
  lastName: string
  fullNameAr: string
  fullNameEn?: string
  fatherName: string
  fatherPhoneNumber?: string
  fatherOccupation?: string
  motherName?: string
  motherPhoneNumber?: string
  motherOccupation?: string
  parentStatus?: string
  dateOfBirth: string
  gender: string
  bloodGroup?: string
  nationality?: string
  address: string
  city: string
  phoneNumber: string
  emergencyContact: string
  // WHY: student.email is the contact/profile email. student.user.email is
  // the actual authentication credential used for login. These are DISTINCT
  // fields. The credential reset section must operate on user.email only.
  email?: string
  schoolName?: string
  regularSchoolGrade?: string
  priorProgrammingExperience?: string
  medicalNotes?: string
  rollNumber?: string
  section?: string
  academicYear: string
  profilePicture?: string
  userId: string
  user?: {
    email: string
    isActive: boolean
  }
}

export default function EditStudentPage() {
  useI18n() // re-render on a language switch
  const router = useRouter()
  const { id } = useParams()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<any>(null)

  // Credentials reset local states
  const [resetEmail, setResetEmail] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [isResetting, setIsResetting] = useState(false)

  const { data: studentRaw, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => fetchApi<StudentEditSource>(`/api/students/${id}`)
  })
  const student = (studentRaw as { data?: StudentEditSource })?.data ?? studentRaw

  useEffect(() => {
    if (student) {
      setFormData({
        firstName: student.firstName,
        lastName: student.lastName,
        fullNameAr: student.fullNameAr,
        fullNameEn: student.fullNameEn || '',
        fatherName: student.fatherName,
        fatherPhoneNumber: student.fatherPhoneNumber || '',
        fatherOccupation: student.fatherOccupation || '',
        motherName: student.motherName || '',
        motherPhoneNumber: student.motherPhoneNumber || '',
        motherOccupation: student.motherOccupation || '',
        parentStatus: student.parentStatus || 'BOTH_ALIVE',
        dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString().split('T')[0] : '',
        gender: student.gender,
        bloodGroup: student.bloodGroup || '',
        nationality: student.nationality || '',
        address: student.address,
        city: student.city,
        phoneNumber: student.phoneNumber,
        emergencyContact: student.emergencyContact,
        email: student.email || '',
        schoolName: student.schoolName || '',
        regularSchoolGrade: student.regularSchoolGrade || '',
        priorProgrammingExperience: student.priorProgrammingExperience || '',
        medicalNotes: student.medicalNotes || '',
        rollNumber: student.rollNumber || '',
        section: student.section || '',
        academicYear: student.academicYear,
      })
      // WHY use student.user?.email (not student.email):
      // student.email is the contact/profile field (e.g. abdulrauf@gmail.com).
      // student.user.email is the actual auth credential stored in the User table.
      // When a student is admitted without an email, the system auto-generates a
      // synthetic login email (e.g. TN.2026.0085@students.technova.local).
      // Pre-populating with the contact email caused the newEmail gate to send
      // undefined (contact email === contact email), leaving the synthetic auth
      // email in place — which is why the student could not log in after reset.
      setResetEmail(student.user?.email || student.email || '')
    }
  }, [student])

  const updateMutation = useMutation({
    mutationFn: (data: any) => fetchApi(`/api/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
    onSuccess: (result: any) => {
      notify.success(L('Student profile updated successfully', 'ملف الطالب اتحدّث'))
      // A linked parent's login number follows the edited phone; if it could not
      // be moved (e.g. number already used by another parent), say so.
      for (const warning of result?.phoneWarnings ?? []) notify.error(warning)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      router.push(`/dashboard/students/${id}`)
    },
    onError: (err: any) => {
      notify.error(err.message || 'Failed to update profile')
    }
  })

  if (isLoading || !formData) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev: any) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [name]: value }))
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      notify.error(L('Please upload a valid image file', 'ارفع صورة صالحة'))
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_WIDTH = 400
        const MAX_HEIGHT = 400
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height
            height = MAX_HEIGHT
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        setFormData((prev: any) => ({ ...prev, profilePicture: dataUrl }))
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleCredentialsReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmail) {
      notify.error(L('Email address cannot be empty', 'الإيميل مش ممكن يبقى فاضي'))
      return
    }
    if (!resetEmail.includes('@')) {
      notify.error(L('Please enter a valid email address', 'اكتب إيميل صحيح'))
      return
    }
    if (!resetPassword) {
      notify.error(L('A new password is required when resetting credentials', 'لازم تكتب باسورد جديد'))
      return
    }
    if (!confirm('Are you sure you want to update login credentials for this student?')) return

    setIsResetting(true)
    try {
      // WHY compare against student.user?.email (not student.email):
      // The gate decides whether to send newEmail to the API. We must compare
      // the admin's input against the CURRENT auth credential (user.email), not
      // the contact email field. Comparing against student.email would suppress
      // the newEmail payload even when the auth email is different (e.g. when
      // the student has a synthetic auto-generated login email but a real contact
      // email), leaving the auth credential unchanged after the reset.
      const currentAuthEmail = student.user?.email || student.email || ''
      await fetchApi('/api/users/reset-credentials', {
        method: 'POST',
        body: JSON.stringify({
          userId: student.userId,
          newEmail: resetEmail !== currentAuthEmail ? resetEmail : undefined,
          newPassword: resetPassword || undefined,
        })
      })
      notify.success(L('Credentials updated successfully! The student can now log in with the new credentials.', 'بيانات الدخول اتغيّرت. الطالب يقدر يدخل بيها دلوقتي.'))
      setResetPassword('')
      queryClient.invalidateQueries({ queryKey: ['student', id] })
    } catch (err: any) {
      notify.error(err.message || 'Failed to reset credentials')
    } finally {
      setIsResetting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateMutation.mutate(formData)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/students/${id}`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{L('Edit Student Profile', 'تعديل ملف الطالب')}</h1>
            <p className="text-sm text-gray-500">Update academic and personal information for {student.firstName}.</p>
          </div>
        </div>
        <Button 
          type="submit" 
          form="edit-student-form" 
          className="bg-blue-600 hover:bg-blue-700 gap-2"
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </Button>
      </div>

      <form id="edit-student-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" /> {L('Personal Details', 'البيانات الشخصية')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              {/* Profile Picture Upload */}
              <div className="flex flex-col sm:flex-row items-start gap-4 pb-2 border-b">
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center bg-gray-50 flex-shrink-0 relative group">
                  {formData.profilePicture ? (
                    <img src={formData.profilePicture} alt="Preview" className="w-full h-full object-cover" />
                  ) : student.profilePicture ? (
                    <img src={student.profilePicture} alt="Current" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <span className="text-xs">{L('No Image', 'مفيش صورة')}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                    <span className="text-white text-xs font-bold text-center px-1">{L('Update', 'غيّر')}<br/>{L('Photo', 'الصورة')}</span>
                  </div>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleImageUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <h3 className="font-medium text-gray-900 text-sm">{L('Profile Picture', 'صورة الطالب')}</h3>
                  <p className="text-[10px] text-gray-500 mt-1 max-w-[200px]">
                    {L('Updating this photo will compress it automatically for ID card compatibility.', 'الصورة هتتصغّر لوحدها علشان تنفع للكارنيه.')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('First Name (English)', 'الاسم الأول (إنجليزي)')}</Label>
                  <Input name="firstName" value={formData.firstName} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label>{L('Last Name (English)', 'اسم العيلة (إنجليزي)')}</Label>
                  <Input name="lastName" value={formData.lastName} onChange={handleChange} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('Full Name (Arabic)', 'الاسم بالكامل (عربي)')}</Label>
                  <Input name="fullNameAr" value={formData.fullNameAr} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label>{L('Full Name (English, for certificates)', 'الاسم بالكامل (إنجليزي، للشهادات)')}</Label>
                  <Input name="fullNameEn" value={formData.fullNameEn} onChange={handleChange} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('Father\'s Name', 'اسم الأب')}</Label>
                  <Input name="fatherName" value={formData.fatherName} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label>{L('Father\'s Phone', 'تليفون الأب')}</Label>
                  {/* Changing it also moves a linked parent's portal login (if the parent had the old number). */}
                  <Input name="fatherPhoneNumber" value={formData.fatherPhoneNumber} onChange={handleChange} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('Mother\'s Name', 'اسم الأم')}</Label>
                  <Input name="motherName" value={formData.motherName} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                  <Label>{L('Mother\'s Phone', 'تليفون الأم')}</Label>
                  <Input name="motherPhoneNumber" value={formData.motherPhoneNumber} onChange={handleChange} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('Date of Birth', 'تاريخ الميلاد')}</Label>
                  <DateInput name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label>{L('Gender', 'النوع')}</Label>
                  <Select value={formData.gender} onValueChange={(val) => handleSelectChange('gender', val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE">{L('Male', 'ولد')}</SelectItem>
                      <SelectItem value="FEMALE">{L('Female', 'بنت')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('Parent Status', 'حالة الوالدين')}</Label>
                  <Select value={formData.parentStatus} onValueChange={(val) => handleSelectChange('parentStatus', val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOTH_ALIVE">{L('Both parents present', 'الوالدين موجودين')}</SelectItem>
                      <SelectItem value="FATHER_DECEASED">{L('Father deceased', 'الأب متوفي')}</SelectItem>
                      <SelectItem value="MOTHER_DECEASED">{L('Mother deceased', 'الأم متوفية')}</SelectItem>
                      <SelectItem value="BOTH_DECEASED">{L('Both deceased', 'الوالدين متوفيين')}</SelectItem>
                      <SelectItem value="DIVORCED">{L('Parents divorced', 'الوالدين منفصلين')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{L('Blood Group', 'فصيلة الدم')}</Label>
                  <Select value={formData.bloodGroup} onValueChange={(val) => handleSelectChange('bloodGroup', val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                        <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{L('School', 'المدرسة')}</Label>
                  <Input name="schoolName" value={formData.schoolName} onChange={handleChange} />
                </div>
                <div className="space-y-2">
                  <Label>{L('School Grade', 'سنة الدراسة')}</Label>
                  <Input name="regularSchoolGrade" value={formData.regularSchoolGrade} onChange={handleChange} placeholder={L('e.g. الصف الرابع الابتدائي', 'مثلاً الصف الرابع الابتدائي')} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{L('Prior Programming Experience', 'خبرة سابقة في البرمجة')}</Label>
                <Input name="priorProgrammingExperience" value={formData.priorProgrammingExperience} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>{L('Medical Notes (optional)', 'ملاحظات طبية (اختياري)')}</Label>
                <Input name="medicalNotes" value={formData.medicalNotes} onChange={handleChange} />
              </div>
            </CardContent>
          </Card>

          {/* Academic Placement */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" /> {L('Academic Placement', 'التسكين')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{L('Roll Number', 'رقم الجلوس')}</Label>
                <Input name="rollNumber" value={formData.rollNumber} onChange={handleChange} required />
              </div>
              <div className="space-y-2">
                <Label>{L('Section', 'الجروب')}</Label>
                <Input name="section" value={formData.section} onChange={handleChange} placeholder={L('e.g. A', 'مثلاً A')} />
              </div>
              {/* Academic year: hidden (owner, 2026-09-29) */}
              <div className="hidden">
                <Label>{L('Academic Year', 'السنة الدراسية')}</Label>
                <Input name="academicYear" value={formData.academicYear} onChange={handleChange} placeholder={L('e.g. 2026-2027', 'مثلاً 2026-2027')} />
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800">
                  <span className="font-bold">{L('Note:', 'ملحوظة:')}</span> {L('Changing the branch uses the Transfers tool; to change groups use “Move” on the student page.', 'تغيير الفرع بيتم من أداة النقل، وتغيير الجروب من زر «نقل» في صفحة الطالب.')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Contact & Address */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" /> {L('Contact & Address', 'التواصل والعنوان')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{L('Email', 'الإيميل')}</Label>
                  <Input type="email" name="email" value={formData.email} onChange={handleChange} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{L('Phone Number', 'رقم التليفون')}</Label>
                    <Input name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} required />
                  </div>
                  <div className="space-y-2">
                    <Label>{L('Emergency Contact', 'رقم الطوارئ')}</Label>
                    <Input name="emergencyContact" value={formData.emergencyContact} onChange={handleChange} required />
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{L('Address', 'العنوان')}</Label>
                  <Input name="address" value={formData.address} onChange={handleChange} required />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-2">
                    <Label>{L('City', 'المدينة')}</Label>
                    <Input name="city" value={formData.city} onChange={handleChange} required />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>

      {/* Administrative User Credentials Reset Card */}
      <Card className="mt-8 rounded-xl border border-rose-200 shadow-md bg-rose-50/20 overflow-hidden">
        <CardHeader className="border-b border-rose-100 bg-rose-50/50 py-4 flex flex-row items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-100 text-rose-700 flex-shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-sm font-black text-rose-900">{L('Administrative Login Credentials Reset', 'إعادة ضبط بيانات الدخول')}</CardTitle>
            <CardDescription className="text-xs text-rose-700/80">{L('Change or reset this student\'s active dashboard login credentials (email & password).', 'غيّر إيميل وباسورد دخول الطالب.')}</CardDescription>
          </div>
        </CardHeader>
        {/* WHY: Show the current auth email explicitly so admins don't confuse
            student.email (contact/profile field) with User.email (login credential).
            Synthetic login emails (e.g. tn.2026.0085@students...) are not visible
            anywhere else in the UI, causing admins to unknowingly type a new email
            that matches the contact email, which suppresses the auth email update. */}
        {student.user?.email && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2">
            <span className="text-amber-600 mt-0.5 flex-shrink-0">ℹ️</span>
            <p className="text-xs text-amber-800">
              <span className="font-bold">{L('Current login email:', 'إيميل الدخول الحالي:')}</span>{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">{student.user.email}</code>
              {student.user.email !== student.email && student.email && (
                <span className="block mt-0.5 text-amber-700">
                  (Contact email on profile: <span className="font-mono">{student.email}</span> — these are different fields)
                </span>
              )}
            </p>
          </div>
        )}
        <CardContent className="pt-6">
          <form onSubmit={handleCredentialsReset} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-rose-900">{L('Dashboard Email', 'إيميل الدخول')}</Label>
              <Input 
                type="email" 
                value={resetEmail} 
                onChange={(e) => setResetEmail(e.target.value)} 
                required 
                className="text-xs h-9 border-rose-200 focus-visible:ring-rose-500 bg-white" 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold text-rose-900">{L('New Password', 'الباسورد الجديد')}</Label>
              <Input 
                type="password" 
                value={resetPassword} 
                onChange={(e) => setResetPassword(e.target.value)} 
                placeholder="•••••••• (Min 8 chars)" 
                className="text-xs h-9 border-rose-200 focus-visible:ring-rose-500 bg-white" 
              />
            </div>
            <div>
              <Button 
                type="submit" 
                disabled={isResetting}
                className="w-full text-xs h-9 bg-rose-600 hover:bg-rose-700 text-white font-bold gap-2 shadow-sm"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {L('Resetting...', 'بيتغيّر...')}
                  </>
                ) : (
                  <>
                    <Key className="w-3.5 h-3.5" />
                    {L('Reset Credentials', 'غيّر بيانات الدخول')}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
