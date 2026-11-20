/** Role names for people (final test 18/11: the sidebar showed BRANCH_MANAGER / SECRETARY raw and "Guardian" in English). */
export const ROLE_NAMES: Record<string, { en: string; ar: string }> = {
  SUPER_ADMIN: { en: 'Super Admin', ar: 'المدير العام' },
  ADMIN: { en: 'Admin', ar: 'إدارة' },
  BRANCH_MANAGER: { en: 'Branch manager', ar: 'مدير فرع' },
  SECRETARY: { en: 'Front desk', ar: 'سكرتارية' },
  ACCOUNTANT: { en: 'Accountant', ar: 'محاسب' },
  MARKETING: { en: 'Marketing', ar: 'تسويق' },
  TEACHER: { en: 'Instructor', ar: 'مدرب' },
  STUDENT: { en: 'Student', ar: 'طالب' },
  PARENT: { en: 'Parent', ar: 'ولي أمر' },
  GUARDIAN: { en: 'Parent', ar: 'ولي أمر' },
}

/** The role in the screen language; an unknown role is shown with spaces, never as CODE_NAME. */
export function roleName(role: string | null | undefined, lang: 'en' | 'ar'): string {
  if (!role) return ''
  const n = ROLE_NAMES[role]
  if (n) return n[lang]
  return role.toLowerCase().replace(/_/g, ' ')
}
