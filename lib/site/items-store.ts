/** x01: website items — read / write (server only). */

import { prisma } from '@/lib/prisma'
import { bothSides, type ItemInput, type ItemKind } from './items'

const data = (v: ItemInput) => {
  const title = bothSides(v.titleEn, v.titleAr)
  return {
    kind: v.kind, category: v.category, titleEn: title.en, titleAr: title.ar,
    textEn: v.textEn || null, textAr: v.textAr || null, metaEn: v.metaEn || null, metaAr: v.metaAr || null,
    imageUrl: v.imageUrl || null, videoUrl: v.videoUrl || null, linkUrl: v.linkUrl || null,
    date: v.date ? new Date(`${v.date}T00:00:00Z`) : null,
    price: v.price ?? null, showPrice: v.showPrice ?? false, inStock: v.inStock ?? true, featured: v.featured ?? false,
    show: v.show ?? true, sortOrder: v.sortOrder ?? 0,
  }
}

export const listItems = (kind?: ItemKind) =>
  prisma.siteItem.findMany({ where: kind ? { kind } : {}, orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }] })

export const createItem = (userId: string, v: ItemInput) => prisma.siteItem.create({ data: { ...data(v), createdById: userId } })
export const updateItem = (id: string, v: ItemInput) => prisma.siteItem.update({ where: { id }, data: data(v) })
export const deleteItem = (id: string) => prisma.siteItem.delete({ where: { id } })

/** What the public website shows: switched on, featured first, then the order staff chose, newest first. */
export async function publicItems() {
  try {
    const rows = await prisma.siteItem.findMany({ where: { show: true }, orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }], take: 120 })
    return rows.map((r) => ({
      id: r.id, kind: r.kind as ItemKind, category: r.category,
      title: { en: r.titleEn, ar: r.titleAr }, text: bothSides(r.textEn, r.textAr), meta: bothSides(r.metaEn, r.metaAr),
      imageUrl: r.imageUrl, videoUrl: r.videoUrl, linkUrl: r.linkUrl, date: r.date ? r.date.toISOString().slice(0, 10) : null,
      price: r.showPrice ? r.price : null, inStock: r.inStock, featured: r.featured,
    }))
  } catch (e) {
    console.error('[SITE_ITEMS]', e)
    return []
  }
}
export type PublicItem = Awaited<ReturnType<typeof publicItems>>[number]
