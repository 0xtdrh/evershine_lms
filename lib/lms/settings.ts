/** LMS settings (AppSetting `lms.settings`). Server-only. */

import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { DEFAULT_UNLOCK_MODE, type UnlockMode } from './unlock'

export interface LmsSettings {
  /** company default way lessons open (owner 2026-10-09: when attendance is recorded) */
  unlockMode: UnlockMode
  /** moving / repeated watermark with the student's name on lesson content */
  watermark: boolean
  /** students this age or younger get kid mode (big, one item per screen, read-aloud) */
  kidModeMaxAge: number
}

export const LMS_DEFAULTS: LmsSettings = { unlockMode: DEFAULT_UNLOCK_MODE, watermark: true, kidModeMaxAge: 7 }

export const getLmsSettings = () => getSetting<LmsSettings>('lms.settings', LMS_DEFAULTS)
export const saveLmsSettings = (v: LmsSettings, userId: string) => setSetting('lms.settings', v, userId)
