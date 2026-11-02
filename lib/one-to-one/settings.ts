/** a02 M3: One-to-One settings (AppSetting oneToOne.settings). Server-only. Rules: request-rules.ts. */

import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { cleanOneToOneSettings, DEFAULT_ONE_TO_ONE_SETTINGS, type OneToOneSettings } from './request-rules'

const KEY = 'oneToOne.settings'

export const getOneToOneSettings = async () => cleanOneToOneSettings(await getSetting<Partial<OneToOneSettings>>(KEY, DEFAULT_ONE_TO_ONE_SETTINGS))
export async function saveOneToOneSettings(v: Partial<OneToOneSettings>, userId: string) {
  const next = cleanOneToOneSettings({ ...(await getOneToOneSettings()), ...v })
  await setSetting(KEY, next, userId)
  return next
}
