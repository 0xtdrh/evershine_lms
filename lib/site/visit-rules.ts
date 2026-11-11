/** x01 analytics: pure rules — where a visitor came from, the device, bots, events. Tested in tests/site-visits.test.ts. */

export const SOURCES = ['DIRECT', 'GOOGLE', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'TIKTOK', 'YOUTUBE', 'OTHER_SEARCH', 'REFERRAL', 'CAMPAIGN'] as const
export type VisitSource = (typeof SOURCES)[number]

export const SOURCE_LABEL: Record<VisitSource, { en: string; ar: string }> = {
  DIRECT: { en: 'Direct (typed / saved link)', ar: 'مباشر (كتب اللينك أو محفوظ)' },
  GOOGLE: { en: 'Google', ar: 'جوجل' },
  FACEBOOK: { en: 'Facebook', ar: 'فيسبوك' },
  INSTAGRAM: { en: 'Instagram', ar: 'إنستجرام' },
  WHATSAPP: { en: 'WhatsApp', ar: 'واتساب' },
  TIKTOK: { en: 'TikTok', ar: 'تيك توك' },
  YOUTUBE: { en: 'YouTube', ar: 'يوتيوب' },
  OTHER_SEARCH: { en: 'Other search engines', ar: 'محركات بحث تانية' },
  REFERRAL: { en: 'Other websites', ar: 'مواقع تانية' },
  CAMPAIGN: { en: 'Campaign link', ar: 'لينك حملة' },
}

export const EVENT_KINDS = ['AUDIENCE', 'CTA', 'FORM_OPEN', 'FORM_SENT', 'WHATSAPP', 'NAV'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

const HOSTS: [RegExp, VisitSource][] = [
  [/(^|\.)google\./, 'GOOGLE'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com|messenger\.com)$/, 'FACEBOOK'],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'INSTAGRAM'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WHATSAPP'],
  [/(^|\.)tiktok\.com$/, 'TIKTOK'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YOUTUBE'],
  [/(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com|yandex\.|baidu\.com|ecosia\.org)/, 'OTHER_SEARCH'],
]

const UTM: [RegExp, VisitSource][] = [
  [/^(fb|facebook|meta)/i, 'FACEBOOK'], [/^(ig|insta)/i, 'INSTAGRAM'], [/^(wa|whatsapp)/i, 'WHATSAPP'],
  [/^google/i, 'GOOGLE'], [/^tiktok/i, 'TIKTOK'], [/^(yt|youtube)/i, 'YOUTUBE'],
]

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '').slice(0, 120) } catch { return null }
}

/**
 * Where the visit came from. A campaign link (utm_source) wins: a known network keeps its name (so "Facebook" counts
 * ads and posts together), anything else is CAMPAIGN. Then the referring site; our own site or nothing = DIRECT.
 */
export function classifySource(referrer: string | null | undefined, utmSource: string | null | undefined, ownHost?: string | null): VisitSource {
  if (utmSource) {
    for (const [re, s] of UTM) if (re.test(utmSource)) return s
    return 'CAMPAIGN'
  }
  const host = hostOf(referrer)
  if (!host || (ownHost && host === ownHost.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, ''))) return 'DIRECT'
  for (const [re, s] of HOSTS) if (re.test(host)) return s
  return 'REFERRAL'
}

export function deviceOf(ua: string | null | undefined): 'MOBILE' | 'TABLET' | 'DESKTOP' {
  const u = (ua ?? '').toLowerCase()
  if (/ipad|tablet|(android(?!.*mobile))/.test(u)) return 'TABLET'
  if (/mobi|iphone|ipod|android/.test(u)) return 'MOBILE'
  return 'DESKTOP'
}

export function isBot(ua: string | null | undefined): boolean {
  return !ua || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp\/|curl|wget|python|axios|node-fetch/i.test(ua)
}

/** A visit that saw one page for less than 15 seconds. */
export const isBounce = (v: { pages: number; seconds: number }) => v.pages <= 1 && v.seconds < 15

/** One ping every 15 s while the tab is visible; a visit is counted at most 2 hours. */
export const PING_SECONDS = 15
export const MAX_VISIT_SECONDS = 2 * 60 * 60
export const IP_KEEP_DAYS = 90
