/** x01: the website's pages — which sections each page shows, their links and titles (pure, tested). */

import type { Bi } from './content'

/** The home page link. '/new-home' while the new site is a preview; it becomes '/' at the switch. */
export const SITE_HOME = '/new-home'

/** false while the new site is a preview (locked, kept out of Google). The switch sets it true and SITE_HOME to '/'. */
export const SITE_LIVE = false

/** The site's public address (for share links, the sitemap and Google). */
export const siteUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://evershine-lms-technova.vercel.app').replace(/\/+$/, '')

export const PAGES = ['home', 'education', 'solutions', 'solution', 'products', 'achievements', 'achievement', 'media', 'partners', 'about', 'verify', 'campaign', 'courses', 'course'] as const
export type SitePage = (typeof PAGES)[number]

export const PAGE_PATH: Record<string, string> = {
  education: '/education', solutions: '/solutions', products: '/products', achievements: '/achievements',
  media: '/media', partners: '/partners', about: '/about', verify: '/verify', courses: '/courses',
  // anchors that live inside a page
  schools: '/education#schools', curriculum: '/education#curriculum', families: '/education#families', divisions: '/about#divisions',
}

/** The home sections each page shows (the header, the last call and the footer are on every page). */
export const PAGE_SECTIONS: Record<SitePage, string[]> = {
  home: ['hero', 'fields', 'numbers', 'about', 'divisions', 'education', 'curriculum', 'solutions', 'why', 'achievements', 'verify', 'products', 'partners', 'media'],
  education: ['education', 'curriculum', 'why'],
  solutions: ['solutions'],
  solution: ['solution'],
  products: ['products'],
  achievements: ['achievements'],
  achievement: ['achievement'],
  media: ['media'],
  partners: ['partners'],
  about: ['about', 'numbers', 'divisions', 'why'],
  verify: ['verify'],
  campaign: ['campaign'],
  courses: ['courses'],
  course: ['course'],
}

export const PAGE_TITLE: Record<Exclude<SitePage, 'home' | 'solution' | 'achievement' | 'campaign' | 'course'>, Bi> = {
  courses: { en: 'Courses', ar: 'الكورسات' },
  education: { en: 'Education', ar: 'التعليم' },
  solutions: { en: 'Solutions', ar: 'الحلول' },
  products: { en: 'Products', ar: 'المنتجات' },
  achievements: { en: 'Achievements & projects', ar: 'الإنجازات والمشاريع' },
  media: { en: 'Media & news', ar: 'الميديا والأخبار' },
  partners: { en: 'Partnerships', ar: 'الشراكات' },
  about: { en: 'About TechNova', ar: 'عن TechNova' },
  verify: { en: 'Check a certificate', ar: 'تأكّد من شهادة' },
}

/** A menu / card link: '#education' (the old one-page links) → '/education'; anything else stays. */
export function pageHref(href: string | undefined | null): string {
  if (!href) return SITE_HOME
  if (href === '#top') return SITE_HOME
  const m = href.match(/^#([a-z]+)$/)
  return m && PAGE_PATH[m[1]] ? PAGE_PATH[m[1]] : href
}

/** The page a link belongs to (for marking the menu). */
export const pageOf = (href: string) => Object.entries(PAGE_PATH).find(([, p]) => p === pageHref(href))?.[0] ?? null

export const slugify = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Paths that are part of the new website (locked while it is a preview). '/verify/<number>' stays public. */
export function isSitePath(path: string): boolean {
  if (path === SITE_HOME) return true
  if (['/education', '/solutions', '/products', '/achievements', '/media', '/partners', '/about', '/verify', '/courses'].includes(path)) return true
  return /^\/(solutions|achievements|c|courses)\/[^/]+$/.test(path)
}
