/** L5: sites the admin added to the tools list (AppSetting `lms.tools`). Server-only. */

import { getSetting, setSetting } from '@/lib/settings/app-settings'
import type { ExtraSite } from './tools'

export interface ToolSettings { extra: ExtraSite[] }
const KEY = 'lms.tools'
export const getToolSettings = async (): Promise<ToolSettings> => ({ extra: [], ...(await getSetting<Partial<ToolSettings>>(KEY, {})) })
export const saveToolSettings = (v: ToolSettings, userId: string) => setSetting(KEY, v, userId)
