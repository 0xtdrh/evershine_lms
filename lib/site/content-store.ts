/** x01: read / save the website content (AppSetting `website.content`). Server only. */

import { prisma } from '@/lib/prisma'
import { setSetting } from '@/lib/settings/app-settings'
import { SITE_CONTENT, type SiteContent } from './content'
import { mergeContent } from './content-merge'

const KEY = 'website.content'

export async function getSiteContent(): Promise<SiteContent> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
    return row ? mergeContent(SITE_CONTENT, row.value) : SITE_CONTENT
  } catch (e) {
    console.error('[WEBSITE_CONTENT_READ]', e)
    return SITE_CONTENT
  }
}

export async function saveSiteContent(userId: string, saved: unknown): Promise<SiteContent> {
  const content = mergeContent(SITE_CONTENT, saved)
  if (JSON.stringify(content).length > 400_000) throw new Error('TOO_BIG')
  await setSetting(KEY, content, userId)
  return content
}

export async function resetSiteContent(): Promise<SiteContent> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } })
  return SITE_CONTENT
}
