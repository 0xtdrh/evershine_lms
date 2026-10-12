/**
 * Arabic names of the dashboard menu items (shown only when the person switches the language to عربي).
 * Keys = the English names used in app/dashboard/layout-client.tsx; a missing key falls back to English.
 */

export const NAV_AR: Record<string, string> = {
  'Dashboard': 'الرئيسية', 'Admin Workspace': 'مساحة الإدارة', 'Permissions': 'الصلاحيات', 'Notifications': 'الإشعارات',
  'Settings Centre': 'مركز الإعدادات', 'Settings': 'الإعدادات', 'Platform': 'تشغيل الأنظمة', 'Agreements': 'الموافقات',
  'Role Assumptions': 'الدخول بدور آخر', 'Credential Management': 'إدارة الحسابات', 'Backups': 'النسخ الاحتياطي',
  'Admissions': 'طلبات الالتحاق', 'Landing Leads': 'عملاء الموقع', 'Students': 'الطلبة', 'Waiting List': 'قائمة الانتظار',
  'Staff Directory': 'الموظفين', 'Fees': 'المصروفات', 'Accounting Hub': 'الحسابات', 'Fee Collection': 'تحصيل المصروفات',
  'Discounts': 'الخصومات', 'Refunds': 'الاسترداد', 'Expense Ledger': 'المصروفات الإدارية', 'Financial Reports': 'التقارير المالية',
  'Wallet & Top-ups': 'المحفظة والشحن', 'Groups Financials': 'ماليات المجموعات', 'Leaves': 'الإجازات', 'Complaints': 'الشكاوى',
  'Referrals': 'الإحالات', 'Academic Queries': 'الاستفسارات الدراسية', 'Staff Salaries': 'رواتب الموظفين',
  'Attendance': 'الحضور', 'Attendance Report': 'تقرير الحضور', 'Staff Attendance': 'حضور الموظفين', 'Biometric Import': 'استيراد البصمة',
  'Exams': 'الامتحانات', 'Results': 'النتائج', 'Report Cards': 'الشهادات الدراسية', 'Certificates': 'الشهادات',
  'Certificate Designer': 'تصميم الشهادات', 'Certificate Reveal': 'كشف الشهادات', 'Promotions': 'الترقيات',
  'My Courses': 'كورساتي', 'My Children': 'أبنائي', 'Groups': 'المجموعات', 'Groups Schedule': 'جدول المجموعات',
  'My Calendar': 'جدولي', 'My Schedule': 'جدولي', 'My Substitutions': 'حصص الاحتياطي', 'Absence Requests': 'طلبات الغياب',
  'Substitute Reconciliation': 'تسوية الاحتياطي', 'Course Structure': 'هيكل الكورسات', 'Grading Weights': 'أوزان التقييم',
  'Academic Engine': 'المحرك الأكاديمي', 'Campuses': 'الفروع', 'Holidays': 'الإجازات الرسمية', 'Renewals': 'التجديدات', 'Session Reports': 'تقارير الحصص', 'Passport & Stamps': 'الجواز والأختام', 'My Passport': 'جوازي', 'My Profile': 'بروفايلي', 'Instructor Performance': 'أداء المدربين',
  'Follow-ups': 'المتابعات', 'Absence Excuses': 'أعذار الغياب', 'Ratings': 'التقييمات', 'Birthdays': 'أعياد الميلاد',
  'Announcements': 'الإعلانات', 'Documents': 'المستندات', 'Calendar': 'التقويم', 'Timetable': 'الجدول القديم',
  'Classes (Legacy)': 'الفصول (قديم)', 'Class Attendance (Legacy)': 'حضور الفصول (قديم)',
  // LMS
  'LMS': 'المنصة التعليمية', 'My Learning': 'تعلّمي', 'Curriculum': 'المنهج', 'Grade Homework': 'تصحيح الواجبات',
  'Quizzes': 'الكويزات', 'Question Bank': 'بنك الأسئلة', 'Rubrics': 'جداول التصحيح', 'LMS Settings': 'إعدادات المنصة التعليمية',
  'Projects Gallery': 'معرض المشاريع', 'My Lessons': 'دروسي', 'My Homework': 'واجباتي', 'My Quizzes': 'كويزاتي',
  // teacher hub
  'My Students': 'طلابي', 'Student Attendance': 'حضور الطلبة', 'Import Attendance': 'استيراد الحضور', 'My Announcements': 'إعلاناتي',
  'Tasks & Marks': 'المهام والدرجات', 'Daily Scores': 'الدرجات اليومية', 'Level Results': 'نتائج المستوى', 'Grade Entry': 'إدخال الدرجات',
  'Student Targets': 'أهداف الطلبة', 'Exam Results': 'نتائج الامتحانات', 'Monthly Monitoring': 'المتابعة الشهرية',
  'Student Leaves': 'إجازات الطلبة', 'HR & Salary': 'الموارد البشرية والراتب',
}

export const navLabel = (name: string, locale: string) => (locale === 'ar' ? NAV_AR[name] ?? name : name)
