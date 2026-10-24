/**
 * Salary settings (2026-10-24, owner): whether an instructor may see his own salary slips (portal "HR & Salary",
 * the slips list and one slip). On by default; Super Admin / Admin switch it on the Salary slips page. Server-only.
 */

import { getSetting, setSetting } from '@/lib/settings/app-settings'

export interface SalarySettings { teacherSeesOwnSlips: boolean }
const KEY = 'salaries.settings'
export const DEFAULT_SALARY_SETTINGS: SalarySettings = { teacherSeesOwnSlips: true }

export const getSalarySettings = () => getSetting<SalarySettings>(KEY, DEFAULT_SALARY_SETTINGS)
export const saveSalarySettings = (v: SalarySettings, userId: string) => setSetting(KEY, v, userId)

/** May this TEACHER see his own slips right now? */
export const teacherSeesOwnSlips = async () => (await getSalarySettings()).teacherSeesOwnSlips
