/**
 * Phase 6 import / export (2026-10-17): EVERY importable / exportable table, one entry each, with its columns in
 * English + Arabic. Shared by the Excel template, the upload check, the Excel / PDF export and the Import & Export
 * centre. Pure (no Prisma): the server side of each dataset is in lib/data-exchange/datasets.ts.
 *
 * Permissions (4 levels, Permissions page): exporting needs `data_export:read` AND the dataset's own permission;
 * importing needs `data_import:create` AND the dataset's create permission. Rows always stay inside the person's places.
 * RULE (owner 2026-10-17, one system): a new table people work with gets an entry here.
 */

import type { AcademicResource as Resource, Action } from '@/lib/rbac'

export type FieldType = 'text' | 'number' | 'date' | 'phone' | 'email' | 'enum' | 'bool' | 'ref'
export type RefKind = 'campus' | 'group' | 'level' | 'instructor'

export interface FieldDef {
  key: string
  en: string
  ar: string
  type: FieldType
  required?: boolean
  /** enum: allowed values (value, English, Arabic) — the cell may hold any of the three */
  options?: { value: string; en: string; ar: string }[]
  /** ref: matched by name inside the person's places */
  ref?: RefKind
  example?: string
  hintEn?: string
  hintAr?: string
  /** shown only in exports (e.g. registration number) */
  exportOnly?: boolean
  /** only in the import template */
  importOnly?: boolean
}

export type DatasetKey =
  | 'students' | 'guardians' | 'groups' | 'instructors' | 'courseStructure'
  | 'invoices' | 'payments' | 'attendance' | 'waitingList' | 'expenses' | 'movements'

export interface DatasetDef {
  key: DatasetKey
  en: string
  ar: string
  descEn: string
  descAr: string
  canImport: boolean
  /** the dataset's own permission for export / import (besides data_export / data_import) */
  exportPerm: [Resource, Action]
  importPerm?: [Resource, Action]
  /** the screen where its buttons also appear */
  page: string
  importNoteEn?: string
  importNoteAr?: string
  /** export filters this dataset understands */
  filters?: ('campus' | 'from' | 'to' | 'group' | 'status')[]
  fields: FieldDef[]
}

const DIRECTION = [{ value: 'IN', en: 'In', ar: 'داخل' }, { value: 'OUT', en: 'Out', ar: 'خارج' }]
const GENDER = [{ value: 'MALE', en: 'Male', ar: 'ذكر' }, { value: 'FEMALE', en: 'Female', ar: 'أنثى' }]
const YESNO = [{ value: 'true', en: 'Yes', ar: 'نعم' }, { value: 'false', en: 'No', ar: 'لا' }]

export const DATASETS: DatasetDef[] = [
  {
    key: 'students', en: 'Students', ar: 'الطلاب',
    descEn: 'Students with their parent and group. Import adds new students the same way as the admission form.',
    descAr: 'الطلاب مع ولي الأمر والجروب. الاستيراد بيضيف طلاب جداد بنفس طريقة فورم التسجيل.',
    canImport: true, exportPerm: ['students', 'read'], importPerm: ['students', 'create'], page: '/dashboard/students',
    importNoteEn: 'Registration numbers are made by the system (TN/YYYY/NNNN). A parent is found by phone or created. A group is joined like "Add to group" (the invoice of the month is made); a full group puts the student on its waiting list.',
    importNoteAr: 'رقم التسجيل بيتعمل لوحده (TN/YYYY/NNNN). ولي الأمر بيتلاقى برقم تليفونه أو بيتعمل. الانضمام للجروب بيتعمل زي «إضافة للجروب» (وفاتورة الشهر بتتعمل)، والجروب المليان بيحط الطالب في قايمة الانتظار.',
    filters: ['campus', 'group', 'status'],
    fields: [
      { key: 'registrationNumber', en: 'Registration no.', ar: 'رقم التسجيل', type: 'text', exportOnly: true },
      { key: 'firstName', en: 'First name', ar: 'الاسم الأول', type: 'text', required: true, example: 'Omar' },
      { key: 'lastName', en: 'Last name', ar: 'اسم العائلة', type: 'text', required: true, example: 'Hassan' },
      { key: 'fullNameAr', en: 'Full Arabic name', ar: 'الاسم الرباعي بالعربي', type: 'text', required: true, example: 'عمر أحمد محمد حسن' },
      { key: 'fatherName', en: 'Father name', ar: 'اسم الأب', type: 'text', required: true, example: 'Ahmed' },
      { key: 'gender', en: 'Gender', ar: 'النوع', type: 'enum', required: true, options: GENDER, example: 'ذكر' },
      { key: 'dateOfBirth', en: 'Date of birth', ar: 'تاريخ الميلاد', type: 'date', required: true, example: '2015-03-21', hintEn: 'YYYY-MM-DD or DD/MM/YYYY', hintAr: 'سنة-شهر-يوم أو يوم/شهر/سنة' },
      { key: 'phoneNumber', en: 'Student / home phone', ar: 'تليفون الطالب / البيت', type: 'phone', required: true, example: '01001234567' },
      { key: 'emergencyContact', en: 'Emergency phone', ar: 'تليفون الطوارئ', type: 'phone', required: true, example: '01001234567' },
      { key: 'address', en: 'Address', ar: 'العنوان', type: 'text', required: true, example: 'El Kawther, Hurghada' },
      { key: 'city', en: 'City', ar: 'المدينة', type: 'text', required: true, example: 'Hurghada' },
      { key: 'campus', en: 'Branch / place', ar: 'الفرع / المكان', type: 'ref', ref: 'campus', required: true },
      { key: 'group', en: 'Group (optional)', ar: 'الجروب (اختياري)', type: 'ref', ref: 'group' },
      { key: 'guardianFirstName', en: 'Parent first name', ar: 'اسم ولي الأمر', type: 'text', example: 'Ahmed' },
      { key: 'guardianLastName', en: 'Parent last name', ar: 'عائلة ولي الأمر', type: 'text', example: 'Hassan' },
      { key: 'guardianPhone', en: 'Parent phone', ar: 'تليفون ولي الأمر', type: 'phone', example: '01112345678', hintEn: 'The parent logs in with this phone', hintAr: 'ولي الأمر بيدخل البوابة بالرقم ده' },
      { key: 'guardianRelationship', en: 'Relationship', ar: 'صلة القرابة', type: 'text', example: 'Father' },
      { key: 'email', en: 'Email', ar: 'الإيميل', type: 'email' },
      { key: 'schoolName', en: 'School', ar: 'المدرسة', type: 'text' },
      { key: 'regularSchoolGrade', en: 'School grade', ar: 'السنة الدراسية', type: 'text' },
      { key: 'medicalNotes', en: 'Medical notes', ar: 'ملاحظات طبية', type: 'text' },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'text', exportOnly: true },
      { key: 'joinedAt', en: 'Joined', ar: 'تاريخ التسجيل', type: 'date', exportOnly: true },
    ],
  },
  {
    key: 'guardians', en: 'Parents', ar: 'أولياء الأمور',
    descEn: 'Parents with their phone and children.', descAr: 'أولياء الأمور بتليفوناتهم وأولادهم.',
    canImport: false, exportPerm: ['students', 'read'], page: '/dashboard/students', filters: ['campus'],
    fields: [
      { key: 'name', en: 'Name', ar: 'الاسم', type: 'text' },
      { key: 'phone', en: 'Phone', ar: 'التليفون', type: 'phone' },
      { key: 'email', en: 'Email', ar: 'الإيميل', type: 'email' },
      { key: 'children', en: 'Children', ar: 'الأولاد', type: 'text' },
      { key: 'campus', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'active', en: 'Active', ar: 'نشط', type: 'bool', options: YESNO },
    ],
  },
  {
    key: 'groups', en: 'Groups', ar: 'الجروبات',
    descEn: 'Groups with level, schedule, instructor and size. Import makes new groups like the Groups page.',
    descAr: 'الجروبات بالمستوى والمواعيد والمدرب والعدد. الاستيراد بيعمل جروبات جديدة زي صفحة الجروبات.',
    canImport: true, exportPerm: ['class_sections', 'read'], importPerm: ['class_sections', 'create'], page: '/dashboard/groups',
    importNoteEn: 'Schedule like "Sun 16:00, Wed 16:00" (Arabic day names work too). The instructor is set from the group page.',
    importNoteAr: 'المواعيد بالشكل ده "الأحد 16:00، الأربعاء 16:00" (الأيام بالإنجليزي كمان بتشتغل). المدرب بيتحدد من صفحة الجروب.',
    filters: ['campus', 'status'],
    fields: [
      { key: 'name', en: 'Group name', ar: 'اسم الجروب', type: 'text', required: true, example: 'Robotics Kids A' },
      { key: 'section', en: 'Section', ar: 'السكشن', type: 'text', example: 'A', hintEn: 'Empty = A', hintAr: 'فاضي = A' },
      { key: 'campus', en: 'Branch / place', ar: 'الفرع / المكان', type: 'ref', ref: 'campus', required: true },
      { key: 'level', en: 'Course — level', ar: 'الكورس — المستوى', type: 'ref', ref: 'level', required: true },
      { key: 'schedule', en: 'Schedule', ar: 'المواعيد', type: 'text', example: 'الأحد 16:00، الأربعاء 16:00' },
      { key: 'maxStudents', en: 'Max students', ar: 'أقصى عدد', type: 'number', example: '12' },
      { key: 'instructor', en: 'Instructor', ar: 'المدرب', type: 'text', exportOnly: true },
      { key: 'students', en: 'Students', ar: 'عدد الطلاب', type: 'number', exportOnly: true },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'text', exportOnly: true },
      { key: 'startDate', en: 'Start date', ar: 'تاريخ البداية', type: 'date', exportOnly: true },
    ],
  },
  {
    key: 'instructors', en: 'Instructors', ar: 'المدربين',
    descEn: 'Instructors and staff profiles. Import adds instructors like the "Add instructor" form.',
    descAr: 'المدربين والموظفين. الاستيراد بيضيف مدربين زي فورم «إضافة مدرب».',
    canImport: true, exportPerm: ['teachers', 'read'], importPerm: ['teachers', 'create'], page: '/dashboard/teachers',
    importNoteEn: 'Each instructor gets a login with the email and a random password; give the real one with "Reset password" (Accounts & passwords).',
    importNoteAr: 'كل مدرب بياخد حساب دخول بالإيميل بكلمة سر عشوائية؛ ادّيله كلمة السر الحقيقية من «إعادة كلمة السر» (الحسابات وكلمات السر).',
    filters: ['campus'],
    fields: [
      { key: 'firstName', en: 'First name', ar: 'الاسم الأول', type: 'text', required: true, example: 'Mona' },
      { key: 'lastName', en: 'Last name', ar: 'اسم العائلة', type: 'text', required: true, example: 'Adel' },
      { key: 'nationalId', en: 'National ID', ar: 'الرقم القومي', type: 'text', required: true, example: '29001011234567' },
      { key: 'gender', en: 'Gender', ar: 'النوع', type: 'enum', required: true, options: GENDER },
      { key: 'dateOfBirth', en: 'Date of birth', ar: 'تاريخ الميلاد', type: 'date', required: true, example: '1995-06-01' },
      { key: 'phoneNumber', en: 'Phone', ar: 'التليفون', type: 'phone', required: true, example: '01001234567' },
      { key: 'email', en: 'Email (login)', ar: 'الإيميل (للدخول)', type: 'email', required: true, example: 'mona@technova.com' },
      { key: 'address', en: 'Address', ar: 'العنوان', type: 'text', required: true, example: 'Hurghada' },
      { key: 'city', en: 'City', ar: 'المدينة', type: 'text', required: true, example: 'Hurghada' },
      { key: 'emergencyContact', en: 'Emergency phone', ar: 'تليفون الطوارئ', type: 'phone', required: true, example: '01001234567' },
      { key: 'designation', en: 'Job title', ar: 'الوظيفة', type: 'text', required: true, example: 'Instructor' },
      { key: 'joiningDate', en: 'Joining date', ar: 'تاريخ التعيين', type: 'date', required: true, example: '2026-09-01' },
      { key: 'campus', en: 'Branch / place', ar: 'الفرع / المكان', type: 'ref', ref: 'campus', required: true },
      { key: 'qualification', en: 'Qualification', ar: 'المؤهل', type: 'text' },
      { key: 'specialization', en: 'Specialization', ar: 'التخصص', type: 'text' },
      { key: 'groups', en: 'Groups', ar: 'الجروبات', type: 'text', exportOnly: true },
      { key: 'active', en: 'Active', ar: 'نشط', type: 'bool', options: YESNO, exportOnly: true },
    ],
  },
  {
    key: 'courseStructure', en: 'Tracks, courses & levels', ar: 'التراكات والكورسات والمستويات',
    descEn: 'One row per level. Import creates the missing tracks, courses and levels (existing ones are kept).',
    descAr: 'سطر لكل مستوى. الاستيراد بيعمل التراكات والكورسات والمستويات الناقصة (الموجود بيفضل زي ما هو).',
    canImport: true, exportPerm: ['subject_offerings', 'read'], importPerm: ['subject_offerings', 'create'], page: '/dashboard/course-config',
    fields: [
      { key: 'track', en: 'Track', ar: 'التراك', type: 'text', required: true, example: 'Robotics' },
      { key: 'course', en: 'Course', ar: 'الكورس', type: 'text', required: true, example: 'NovaBuilders' },
      { key: 'courseCode', en: 'Course code', ar: 'كود الكورس', type: 'text', example: 'NOVA-BLD', hintEn: 'Empty = made from the name', hintAr: 'فاضي = بيتعمل من الاسم' },
      { key: 'level', en: 'Level', ar: 'المستوى', type: 'text', required: true, example: 'Level 1' },
      { key: 'order', en: 'Level order', ar: 'ترتيب المستوى', type: 'number', required: true, example: '1' },
      { key: 'sessions', en: 'Sessions', ar: 'عدد الحصص', type: 'number', required: true, example: '8' },
      { key: 'months', en: 'Months', ar: 'عدد الشهور', type: 'number', required: true, example: '1' },
      { key: 'pricing', en: 'Pricing', ar: 'نظام الدفع', type: 'enum', required: true, options: [{ value: 'MONTHLY', en: 'Monthly', ar: 'شهري' }, { value: 'FULL_LEVEL', en: 'Full level', ar: 'المستوى كامل' }], example: 'شهري' },
      { key: 'price', en: 'Price (EGP)', ar: 'السعر (ج.م)', type: 'number', required: true, example: '850' },
    ],
  },
  {
    key: 'invoices', en: 'Invoices', ar: 'الفواتير', descEn: 'Invoices with paid, remaining and status.', descAr: 'الفواتير بالمدفوع والباقي والحالة.',
    canImport: false, exportPerm: ['fees', 'read'], page: '/dashboard/fees', filters: ['campus', 'from', 'to', 'status'],
    fields: [
      { key: 'number', en: 'Invoice no.', ar: 'رقم الفاتورة', type: 'text' },
      { key: 'student', en: 'Student', ar: 'الطالب', type: 'text' },
      { key: 'registrationNumber', en: 'Registration no.', ar: 'رقم التسجيل', type: 'text' },
      { key: 'group', en: 'Group', ar: 'الجروب', type: 'text' },
      { key: 'month', en: 'For', ar: 'عن', type: 'text' },
      { key: 'total', en: 'Total', ar: 'الإجمالي', type: 'number' },
      { key: 'discount', en: 'Discount', ar: 'الخصم', type: 'number' },
      { key: 'paid', en: 'Paid', ar: 'المدفوع', type: 'number' },
      { key: 'refunded', en: 'Refunded', ar: 'المسترد', type: 'number' },
      { key: 'remaining', en: 'Remaining', ar: 'الباقي', type: 'number' },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'text' },
      { key: 'dueDate', en: 'Due date', ar: 'ميعاد الدفع', type: 'date' },
      { key: 'createdAt', en: 'Issued', ar: 'تاريخ الإصدار', type: 'date' },
    ],
  },
  {
    key: 'payments', en: 'Payments', ar: 'المدفوعات', descEn: 'Every payment with its receipt number and source.', descAr: 'كل دفعة برقم الإيصال ومصدرها.',
    canImport: false, exportPerm: ['fees', 'read'], page: '/dashboard/accountant/fees', filters: ['campus', 'from', 'to'],
    fields: [
      { key: 'receipt', en: 'Receipt no.', ar: 'رقم الإيصال', type: 'text' },
      { key: 'date', en: 'Date', ar: 'التاريخ', type: 'date' },
      { key: 'student', en: 'Student', ar: 'الطالب', type: 'text' },
      { key: 'registrationNumber', en: 'Registration no.', ar: 'رقم التسجيل', type: 'text' },
      { key: 'invoice', en: 'Invoice no.', ar: 'رقم الفاتورة', type: 'text' },
      { key: 'amount', en: 'Amount', ar: 'المبلغ', type: 'number' },
      { key: 'method', en: 'Method', ar: 'طريقة الدفع', type: 'text' },
      { key: 'source', en: 'Source', ar: 'المصدر', type: 'text' },
      { key: 'receivedBy', en: 'Received by', ar: 'استلمها', type: 'text' },
    ],
  },
  {
    key: 'attendance', en: 'Attendance', ar: 'الحضور', descEn: 'Attendance per student and session date.', descAr: 'الحضور لكل طالب وتاريخ حصة.',
    canImport: false, exportPerm: ['attendance', 'read'], page: '/dashboard/attendance', filters: ['campus', 'from', 'to', 'group'],
    fields: [
      { key: 'date', en: 'Date', ar: 'التاريخ', type: 'date' },
      { key: 'group', en: 'Group', ar: 'الجروب', type: 'text' },
      { key: 'student', en: 'Student', ar: 'الطالب', type: 'text' },
      { key: 'registrationNumber', en: 'Registration no.', ar: 'رقم التسجيل', type: 'text' },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'text' },
      { key: 'note', en: 'Note', ar: 'ملاحظة', type: 'text' },
    ],
  },
  {
    key: 'waitingList', en: 'Waiting list', ar: 'قايمة الانتظار', descEn: 'Who waits for which level or group.', descAr: 'مين مستني أنهي مستوى أو جروب.',
    canImport: false, exportPerm: ['waiting_list', 'read'], page: '/dashboard/waiting-list', filters: ['campus'],
    fields: [
      { key: 'student', en: 'Student', ar: 'الطالب', type: 'text' },
      { key: 'phone', en: 'Parent phone', ar: 'تليفون ولي الأمر', type: 'phone' },
      { key: 'level', en: 'Level', ar: 'المستوى', type: 'text' },
      { key: 'group', en: 'Group', ar: 'الجروب', type: 'text' },
      { key: 'campus', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'since', en: 'Waiting since', ar: 'مستني من', type: 'date' },
    ],
  },
  {
    key: 'expenses', en: 'Running costs', ar: 'مصاريف التشغيل', descEn: 'Expenses by category and date.', descAr: 'المصاريف حسب البند والتاريخ.',
    canImport: false, exportPerm: ['expenses', 'read'], page: '/dashboard/accountant/expenses', filters: ['campus', 'from', 'to'],
    fields: [
      { key: 'date', en: 'Date', ar: 'التاريخ', type: 'date' },
      { key: 'category', en: 'Category', ar: 'البند', type: 'text' },
      { key: 'description', en: 'Description', ar: 'الوصف', type: 'text' },
      { key: 'amount', en: 'Amount', ar: 'المبلغ', type: 'number' },
      { key: 'campus', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'method', en: 'Paid by', ar: 'اتدفع بـ', type: 'text' },
    ],
  },
]

/** Stored codes shown in exports (status, payment source, attendance) → the reader's language. */
const CODES: Record<string, [string, string]> = {
  ACTIVE: ['Active', 'نشط'], WITHDRAWN: ['Withdrawn', 'منسحب'], GRADUATED: ['Graduated', 'متخرج'], SUSPENDED: ['Suspended', 'موقوف'],
  ON_LEAVE: ['On leave', 'في إجازة'], COMPLETED: ['Completed', 'خلص'], ISSUED: ['Issued', 'صادرة'], PAID: ['Paid', 'مدفوعة'],
  PARTIALLY_PAID: ['Partly paid', 'مدفوعة جزئيًا'], OVERDUE: ['Overdue', 'متأخرة'], CANCELLED: ['Cancelled', 'ملغية'],
  PRESENT: ['Present', 'حاضر'], ABSENT: ['Absent', 'غايب'], LATE: ['Late', 'متأخر'], EXCUSED: ['Excused', 'بعذر'],
  STAFF: ['Staff', 'موظف'], PROOF: ['Receipt', 'إيصال'], ONLINE: ['Online', 'أونلاين'], WALLET: ['Wallet', 'المحفظة'],
}
export const codeLabel = (v: unknown, ar: boolean) => (typeof v === 'string' && CODES[v] ? CODES[v][ar ? 1 : 0] : v)

export const MOVEMENTS_DATASET: DatasetDef = {
  key: 'movements', en: 'Account movements', ar: 'حركات الحسابات', descEn: 'Money in and out of every account (cash boxes, bank, wallets).', descAr: 'الفلوس اللي دخلت وخرجت من كل حساب (الخزن، البنك، المحافظ).',
  canImport: false, exportPerm: ['treasury', 'read'], page: '/dashboard/treasury', filters: ['campus', 'from', 'to'],
  fields: [
    { key: 'date', en: 'Date', ar: 'التاريخ', type: 'date' },
    { key: 'account', en: 'Account', ar: 'الحساب', type: 'text' },
    { key: 'direction', en: 'In / out', ar: 'داخل / خارج', type: 'enum', options: DIRECTION },
    { key: 'amount', en: 'Amount', ar: 'المبلغ', type: 'number' },
    { key: 'kind', en: 'What', ar: 'إيه', type: 'text' },
    { key: 'method', en: 'Method', ar: 'الطريقة', type: 'text' },
    { key: 'note', en: 'Note', ar: 'ملاحظة', type: 'text' },
  ],
}
DATASETS.push(MOVEMENTS_DATASET)

export const datasetByKey = (key: string) => DATASETS.find((d) => d.key === key) ?? null
export const importFields = (d: DatasetDef) => d.fields.filter((f) => !f.exportOnly)
export const exportFields = (d: DatasetDef) => d.fields.filter((f) => !f.importOnly)

/** What this person may do with a dataset (the permission check is passed in so overrides apply). */
export function exchangeRights(d: DatasetDef, can: (r: Resource, a: Action) => boolean) {
  return {
    export: can('data_export', 'read') && can(d.exportPerm[0], d.exportPerm[1]),
    import: d.canImport && !!d.importPerm && can('data_import', 'create') && can(d.importPerm[0], d.importPerm[1]),
  }
}
