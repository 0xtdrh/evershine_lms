/**
 * Platform-level settings (docs/plan-learning-platform.md §14): master switches for whole modules and the default
 * language. Every big module checks its switch, so it can be turned on step by step at launch or switched off
 * instantly if it causes a problem. Server-only.
 */

import { getSetting, setSetting } from '@/lib/settings/app-settings'
import type { Locale } from '@/lib/i18n/messages'

export const MODULES = [
  { key: 'lms', label: 'LMS (lessons, homework, quizzes)', labelAr: 'المنصة التعليمية (الدروس والواجبات والكويزات)' },
  { key: 'passport', label: 'TechNova Passport', labelAr: 'جواز TechNova' },
  { key: 'gamification', label: 'Gamification (XP, badges, challenges, store)', labelAr: 'التحفيز (النقاط والأوسمة والتحديات والمتجر)' },
  { key: 'platformFee', label: 'Platform subscription fee', labelAr: 'رسوم اشتراك المنصة' },
  { key: 'addons', label: 'Add-ons shop', labelAr: 'متجر الإضافات' },
  { key: 'treasury', label: 'Treasury & cash flow', labelAr: 'الخزينة والتدفق النقدي' },
  { key: 'agreements', label: 'Agreements (parents must accept before using the portal)', labelAr: 'الموافقات (لازم ولي الأمر يوافق قبل استخدام البوابة)' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']
export type ModuleSwitches = Record<ModuleKey, boolean>

/** New modules start OFF; the owner switches them on when ready. Agreements are ON (they protect the company). */
export const MODULE_DEFAULTS: ModuleSwitches = { lms: false, passport: false, gamification: false, platformFee: false, addons: false, treasury: false, agreements: true }

export interface LanguageDefaults { staff: Locale; portal: Locale }
export const LANGUAGE_DEFAULTS: LanguageDefaults = { staff: 'en', portal: 'en' }

export async function getModules(): Promise<ModuleSwitches> {
  return { ...MODULE_DEFAULTS, ...(await getSetting<Partial<ModuleSwitches>>('platform.modules', {})) }
}
export async function saveModules(v: Partial<ModuleSwitches>, userId: string) {
  const clean: Partial<ModuleSwitches> = {}
  for (const m of MODULES) if (typeof v[m.key] === 'boolean') clean[m.key] = v[m.key]
  const next = { ...(await getModules()), ...clean }
  await setSetting('platform.modules', next, userId)
  return next
}
export const isModuleOn = async (key: ModuleKey) => (await getModules())[key]

export async function getLanguageDefaults(): Promise<LanguageDefaults> {
  return { ...LANGUAGE_DEFAULTS, ...(await getSetting<Partial<LanguageDefaults>>('platform.language', {})) }
}
export const saveLanguageDefaults = (v: LanguageDefaults, userId: string) => setSetting('platform.language', v, userId)
