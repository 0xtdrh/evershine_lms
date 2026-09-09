/**
 * Role-Based Access Control (RBAC) Matrix
 *
 * WHY data-driven RBAC (not if/else chains): A matrix keeps permissions
 * auditable in one place. Adding a new role or resource only requires
 * updating this file, not hunting through 20 route handlers.
 *
 * TRADEOFF: This is a coarse-grained RBAC. Row-level security (e.g., a
 * teacher may only read their own assigned classes) is enforced in the
 * service layer, not here.
 */

import type { Role } from '@prisma/client'

// WHY export/approve added: originally only create/read/update/delete existed.
// 'export' gates bulk data exports (reports, spreadsheets); 'approve' gates
// workflow approval steps (e.g. admissions approval, leave approval).
export type Action = 'create' | 'read' | 'update' | 'delete' | 'export' | 'approve'
export type AcademicResource =
  | 'students'
  | 'teachers'
  | 'batches'
  | 'campuses'
  | 'classes'
  | 'houses'
  | 'fees'
  | 'attendance'
  | 'documents'
  | 'users'
  | 'audit_logs'
  | 'dashboard'
  | 'results'
  | 'exams'
  | 'announcements'
  | 'calendar'
  | 'academic_years'
  | 'shifts'
  | 'class_sections'
  | 'subject_offerings'
  | 'subject_enrollments'
  | 'timetable_engine'
  | 'grading_engine'
  | 'promotions'
  | 'fee_penalties'
  | 'teacher_penalties'
  | 'expenses'
  // WHY: Leads/Admissions was previously gated by a hardcoded role check in
  // app/api/admissions/**; it is now a first-class RBAC resource so it can be
  // managed from the Permissions page without touching code.
  | 'admissions'

type Resource = AcademicResource

type PermissionMap = Record<Role, Record<Resource, Action[]>>

const ROLE_ALIASES: Record<string, Role> = {
  SUPERADMIN: 'SUPER_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPER_ADMINISTRATOR: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  ADMINISTRATOR: 'ADMIN',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
  GUARDIAN: 'GUARDIAN',
  ACCOUNTANT: 'ACCOUNTANT',
  ACCOUNT_MANAGER: 'ACCOUNTANT',
  SECRETARY: 'SECRETARY',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  MARKETING: 'MARKETING',
}

/**
 * Converts display/session role labels into the canonical Prisma Role enum.
 *
 * WHY: Some deployed sessions and impersonation flows can expose display labels
 * such as "Super Admin" while API authorization expects enum values like
 * "SUPER_ADMIN". Normalizing at the RBAC boundary prevents false 403s without
 * granting access to unknown roles.
 */
export function normalizeRole(role: Role | string | null | undefined): Role | null {
  if (!role) return null

  const key = String(role)
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return ROLE_ALIASES[key] ?? null
}

// WHY typed as const: Ensures exhaustive coverage — TypeScript will error
// if a new Role or Resource is added without updating this matrix.
const PERMISSIONS: PermissionMap = {
  SUPER_ADMIN: {
    students: ['create', 'read', 'update', 'delete'],
    teachers: ['create', 'read', 'update', 'delete'],
    batches: ['create', 'read', 'update', 'delete'],
    campuses: ['create', 'read', 'update', 'delete'],
    classes: ['create', 'read', 'update', 'delete'],
    houses: ['create', 'read', 'update', 'delete'],
    fees: ['create', 'read', 'update', 'delete'],
    attendance: ['create', 'read', 'update', 'delete'],
    documents: ['create', 'read', 'update', 'delete'],
    users: ['create', 'read', 'update', 'delete'],
    audit_logs: ['read'],
    dashboard: ['read'],
    results: ['create', 'read', 'update', 'delete'],
    exams: ['create', 'read', 'update', 'delete'],
    announcements: ['create', 'read', 'update', 'delete'],
    calendar: ['create', 'read', 'update', 'delete'],
    academic_years: ['create', 'read', 'update', 'delete'],
    shifts: ['create', 'read', 'update', 'delete'],
    class_sections: ['create', 'read', 'update', 'delete'],
    subject_offerings: ['create', 'read', 'update', 'delete'],
    subject_enrollments: ['create', 'read', 'update', 'delete'],
    timetable_engine: ['create', 'read', 'update', 'delete'],
    grading_engine: ['create', 'read', 'update', 'delete'],
    promotions: ['create', 'read', 'update', 'delete'],
    fee_penalties: ['create', 'read', 'update', 'delete'],
    teacher_penalties: ['create', 'read', 'update', 'delete'],
    expenses: ['create', 'read', 'update', 'delete'],
    admissions: ['create', 'read', 'update', 'delete', 'approve', 'export'],
  },
  ADMIN: {
    students: ['create', 'read', 'update', 'delete'],
    teachers: ['create', 'read', 'update', 'delete'],
    batches: ['create', 'read', 'update', 'delete'],
    campuses: ['read', 'update'],
    classes: ['create', 'read', 'update', 'delete'],
    houses: ['read', 'update', 'delete'],
    fees: ['create', 'read', 'update', 'delete'],
    attendance: ['create', 'read', 'update', 'delete'],
    documents: ['create', 'read', 'update', 'delete'],
    users: ['read'],
    audit_logs: ['read'],
    dashboard: ['read'],
    results: ['create', 'read', 'update', 'delete'],
    exams: ['create', 'read', 'update', 'delete'],
    announcements: ['create', 'read', 'update', 'delete'],
    calendar: ['create', 'read', 'update', 'delete'],
    academic_years: ['create', 'read', 'update'],
    shifts: ['read', 'update'],
    class_sections: ['create', 'read', 'update', 'delete'],
    subject_offerings: ['create', 'read', 'update', 'delete'],
    subject_enrollments: ['create', 'read', 'update', 'delete'],
    timetable_engine: ['create', 'read', 'update', 'delete'],
    grading_engine: ['create', 'read', 'update', 'delete'],
    promotions: ['create', 'read', 'update', 'delete'],
    fee_penalties: ['create', 'read', 'update', 'delete'],
    teacher_penalties: ['create', 'read', 'update'],
    expenses: ['create', 'read', 'update', 'delete'],
    admissions: ['create', 'read', 'update', 'approve', 'export'],
  },
  TEACHER: {
    students: ['read'],
    teachers: ['read'],
    batches: ['read'],
    campuses: ['read'],
    classes: ['read'],
    houses: ['read'],
    fees: ['read'],
    // WHY: Teachers can create and read attendance for their assigned classes
    attendance: ['create', 'read'],
    documents: ['read'],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: ['create', 'read', 'update', 'delete'],
    exams: ['read'],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['read'],
    timetable_engine: ['read'],
    grading_engine: ['create', 'read'],
    promotions: [],
    fee_penalties: [],
    teacher_penalties: ['read'],
    expenses: [],
    admissions: [],
  },
  STUDENT: {
    students: ['read'],
    teachers: ['read'],
    batches: ['read'],
    campuses: ['read'],
    classes: ['read'],
    houses: ['read'],
    fees: ['read'],
    attendance: ['read'],
    documents: ['read'],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: ['read'],
    exams: ['read'],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['create', 'read'],
    timetable_engine: ['read'],
    grading_engine: ['read'],
    promotions: [],
    fee_penalties: ['read'],
    teacher_penalties: [],
    expenses: [],
    admissions: [],
  },
  PARENT: {
    students: ['read'],
    teachers: ['read'],
    batches: ['read'],
    campuses: ['read'],
    classes: ['read'],
    houses: ['read'],
    fees: ['read'],
    attendance: ['read'],
    documents: ['read'],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: ['read'],
    exams: ['read'],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['read'],
    timetable_engine: ['read'],
    grading_engine: ['read'],
    promotions: [],
    fee_penalties: ['read'],
    teacher_penalties: [],
    expenses: [],
    admissions: [],
  },
  ACCOUNTANT: {
    students: ['read'],
    teachers: [],
    batches: [],
    campuses: ['read'],
    // Allow accountants to read class records so finance workflows can
    // filter by class/section when issuing invoices or exporting reports.
    classes: ['read'],
    houses: [],
    fees: ['create', 'read', 'update'],
    attendance: [],
    documents: [],
    users: [],
    audit_logs: ['read'],
    dashboard: ['read'],
    results: [],
    exams: [],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['read'],
    timetable_engine: ['read'],
    grading_engine: ['read'],
    promotions: [],
    fee_penalties: ['create', 'read', 'update'],
    teacher_penalties: [],
    expenses: ['create', 'read', 'update', 'delete'],
    admissions: ['read', 'export'],
  },
  GUARDIAN: {
    students: ['read'],
    teachers: ['read'],
    batches: ['read'],
    campuses: ['read'],
    classes: ['read'],
    houses: ['read'],
    fees: ['read'],
    attendance: ['read'],
    documents: ['read'],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: ['read'],
    exams: ['read'],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['read'],
    timetable_engine: ['read'],
    grading_engine: ['read'],
    promotions: [],
    fee_penalties: ['read'],
    teacher_penalties: [],
    expenses: [],
    admissions: [],
  },
  // ── SECRETARY ────────────────────────────────────────────────────────────
  // Front-desk operations for a single campus: student registration/edits,
  // attendance, and recording fee payments. No financial reporting, no
  // administrative/user-management access.
  SECRETARY: {
    students: ['create', 'read', 'update'],
    teachers: ['read'],
    batches: ['read'],
    campuses: ['read'],
    classes: ['read'],
    houses: ['read'],
    fees: ['create', 'read'],
    attendance: ['create', 'read', 'update'],
    documents: ['create', 'read'],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: ['read'],
    exams: ['read'],
    announcements: ['read'],
    calendar: ['create', 'read', 'update'],
    academic_years: ['read'],
    shifts: ['read'],
    class_sections: ['read'],
    subject_offerings: ['read'],
    subject_enrollments: ['read'],
    timetable_engine: ['read'],
    grading_engine: [],
    promotions: [],
    fee_penalties: ['read'],
    teacher_penalties: [],
    expenses: [],
    admissions: ['create', 'read', 'update'],
  },
  // ── BRANCH_MANAGER ───────────────────────────────────────────────────────
  // ADMIN-equivalent resource permissions, but data is scoped to the
  // manager's own campus via session.user.campusId in the API layer (see
  // the campus-scoping checks in app/api/**). Explicitly denied: managing
  // user accounts/roles and editing campus records (read-only on campuses).
  BRANCH_MANAGER: {
    students: ['create', 'read', 'update', 'delete'],
    teachers: ['create', 'read', 'update', 'delete'],
    batches: ['create', 'read', 'update', 'delete'],
    campuses: ['read'],
    classes: ['create', 'read', 'update', 'delete'],
    houses: ['read', 'update', 'delete'],
    fees: ['create', 'read', 'update', 'delete'],
    attendance: ['create', 'read', 'update', 'delete'],
    documents: ['create', 'read', 'update', 'delete'],
    users: ['read'],
    audit_logs: ['read'],
    dashboard: ['read'],
    results: ['create', 'read', 'update', 'delete'],
    exams: ['create', 'read', 'update', 'delete'],
    announcements: ['create', 'read', 'update', 'delete'],
    calendar: ['create', 'read', 'update', 'delete'],
    academic_years: ['read'],
    shifts: ['read', 'update'],
    class_sections: ['create', 'read', 'update', 'delete'],
    subject_offerings: ['create', 'read', 'update', 'delete'],
    subject_enrollments: ['create', 'read', 'update', 'delete'],
    timetable_engine: ['create', 'read', 'update', 'delete'],
    grading_engine: ['create', 'read', 'update', 'delete'],
    promotions: ['create', 'read', 'update', 'delete'],
    fee_penalties: ['create', 'read', 'update', 'delete'],
    teacher_penalties: ['create', 'read', 'update'],
    expenses: ['create', 'read', 'update', 'delete'],
    admissions: ['create', 'read', 'update', 'delete', 'approve', 'export'],
  },
  // ── MARKETING ────────────────────────────────────────────────────────────
  // Leads/Admissions only. No visibility into enrolled students, finance,
  // or any administrative resource.
  MARKETING: {
    students: [],
    teachers: [],
    batches: [],
    campuses: ['read'],
    classes: [],
    houses: [],
    fees: [],
    attendance: [],
    documents: [],
    users: [],
    audit_logs: [],
    dashboard: ['read'],
    results: [],
    exams: [],
    announcements: ['read'],
    calendar: ['read'],
    academic_years: [],
    shifts: [],
    class_sections: [],
    subject_offerings: [],
    subject_enrollments: [],
    timetable_engine: [],
    grading_engine: [],
    promotions: [],
    fee_penalties: [],
    teacher_penalties: [],
    expenses: [],
    admissions: ['create', 'read', 'update', 'export'],
  },
}

/**
 * Check if a role has permission to perform an action on a resource.
 * @param role - The user's role from the session
 * @param resource - The resource being accessed
 * @param action - The action being attempted
 * @returns true if permitted, false otherwise
 */
export function checkPermission(role: Role | string | null | undefined, resource: Resource, action: Action): boolean {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole) return false

  const allowed = PERMISSIONS[normalizedRole]?.[resource] ?? []
  return allowed.includes(action)
}

/**
 * Returns the allowed actions for a role on a resource.
 * Useful for building role-aware UI navigation.
 */
export function getAllowedActions(role: Role | string | null | undefined, resource: Resource): Action[] {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole) return []

  return PERMISSIONS[normalizedRole]?.[resource] ?? []
}

/**
 * Default permission matrix used for admin configuration and fallback checks.
 */
export const DEFAULT_PERMISSION_MATRIX = PERMISSIONS

/** Roles that have admin-level system access */
export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']

/** Roles that can mark attendance */
export const ATTENDANCE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'BRANCH_MANAGER', 'SECRETARY']

/** Roles that can mark teacher HR attendance */
export const TEACHER_HR_ATTENDANCE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']

/** Roles that can manage financial records */
export const FINANCE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT']

/** Roles whose data access must be scoped to their own campus (session.user.campusId) */
export const CAMPUS_SCOPED_ROLES: Role[] = ['ADMIN', 'BRANCH_MANAGER']

/** Roles that may only access the Leads/Admissions workflow */
export const ADMISSIONS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'MARKETING']
