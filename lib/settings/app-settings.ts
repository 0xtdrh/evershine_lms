/**
 * Key/value settings stored in the AppSetting table (JSON values). Server-only.
 * Each setting has a default in code, so a missing row is never an error.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } })
    if (!row) return fallback
    // Merge objects so settings added later get their default value.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && row.value && typeof row.value === 'object') {
      return { ...fallback, ...(row.value as object) } as T
    }
    return row.value as T
  } catch (err) {
    console.error('[APP_SETTING_READ]', key, err)
    return fallback
  }
}

export async function setSetting(key: string, value: unknown, userId?: string) {
  const json = value as Prisma.InputJsonValue
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json, updatedById: userId ?? null },
    update: { value: json, updatedById: userId ?? null },
  })
}
