/**
 * x01: renders one website page on the server — the preview lock (localhost = anyone, a real domain = admins only, else
 * 404), the content, the real items and the live numbers. Every website route is a few lines that call this.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { siteStats } from '@/lib/site/stats'
import { getSiteContent } from '@/lib/site/content-store'
import { publicItems } from '@/lib/site/items-store'
import { activeBanner, campaignBySlug } from '@/lib/site/campaigns-store'
import { publicCatalog } from '@/lib/site/courses-store'
import { redirect } from 'next/navigation'
import { canOpenSitePreview } from '@/lib/site/preview-access'
import { PAGE_PATH, PAGE_TITLE, SITE_HOME, SITE_LIVE, siteUrl, slugify, type SitePage as Page } from '@/lib/site/pages'
import type { CertificateCheck } from '@/lib/site/verify'
import { siteFontClass } from '@/lib/site/fonts'
import SiteHome, { type SiteDetail } from './SiteHome'

const PATH: Record<string, string> = { home: SITE_HOME, ...PAGE_PATH }

/** Title, description, share card and canonical link of a website page (Arabic first: most visitors are Egyptian). */
export async function siteGenerateMetadata(page: Page, slug?: string, id?: string): Promise<Metadata> {
  const C = await getSiteContent()
  let title = page in PAGE_TITLE ? PAGE_TITLE[page as keyof typeof PAGE_TITLE].ar : `${C.hero.title1.ar} ${C.hero.title2.ar}`
  let description = ({
    home: C.hero.text.ar, education: `${C.education.text.ar} ${C.curriculum.text.ar}`, solutions: C.solutions.text.ar,
    products: C.products.text.ar, achievements: C.achievements.text.ar, media: C.media.title.ar, partners: C.partners.text.ar,
    about: C.about.text.ar, verify: C.verify.text.ar,
  } as Record<string, string>)[page] ?? C.hero.text.ar
  let path = PATH[page] ?? SITE_HOME
  let image = '/brand/bglogo.png'
  if (page === 'solution' && slug) {
    const s = C.solutions.items.find((x) => slugify(x.title.en) === slug)
    if (s) { title = s.title.ar; description = s.text.ar; path = `/solutions/${slug}` }
  }
  if (page === 'achievement' && id) {
    const it = (await publicItems()).find((x) => x.id === id)
    if (it) { title = it.title.ar; description = it.text.ar || it.meta.ar || description; path = `/achievements/${id}`; image = it.imageUrl || image }
  }
  const url = `${siteUrl()}${path === '/' ? '' : path}`
  const full = page === 'home' ? `TechNova — ${title}` : `${title} | TechNova`
  return {
    title: { absolute: full },
    description: description.slice(0, 300),
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'TechNova', locale: 'ar_EG', title: full, description: description.slice(0, 300), url, images: [{ url: image.startsWith('http') ? image : `${siteUrl()}${image}` }] },
    twitter: { card: 'summary_large_image', title: full, description: description.slice(0, 300) },
    robots: SITE_LIVE ? { index: true, follow: true } : { index: false, follow: false },
  }
}

/** Organisation details for Google (home page only). */
function OrgJsonLd({ C }: { C: Awaited<ReturnType<typeof getSiteContent>> }) {
  const same = [C.contact.facebook, C.contact.instagram, C.contact.tiktok, C.contact.youtube, C.contact.linkedin].filter(Boolean)
  const data = {
    '@context': 'https://schema.org', '@type': 'EducationalOrganization', name: 'TechNova', url: siteUrl(),
    logo: `${siteUrl()}/brand/bglogo.png`, description: C.hero.text.en,
    address: { '@type': 'PostalAddress', addressLocality: 'Hurghada', addressCountry: 'EG', streetAddress: C.contact.address.en },
    ...(C.contact.phone ? { telephone: C.contact.phone } : {}), ...(C.contact.email ? { email: C.contact.email } : {}), ...(same.length ? { sameAs: same } : {}),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}

export async function SitePage({ page, slug, id, open, certificate }: { page: Page; slug?: string; id?: string; open?: boolean; certificate?: { number: string; result: CertificateCheck | null } }) {
  const host = (await headers()).get('host')
  const session = await auth()
  if (!open && !SITE_LIVE && !canOpenSitePreview(host, session?.user?.role)) notFound()
  const [stats, content, items, banner] = await Promise.all([siteStats(), getSiteContent(), publicItems(), activeBanner()])
  let detail: SiteDetail | undefined = certificate ? { certificate } : undefined
  let courses: Awaited<ReturnType<typeof publicCatalog>> = []
  if (page === 'courses') courses = await publicCatalog()
  if (page === 'course' || page === 'join') {
    courses = slug ? await publicCatalog({ slug }) : []
    if (!courses.length) notFound()
  }
  if (page === 'campaign') {
    const campaign = slug ? await campaignBySlug(slug) : null
    if (!campaign || campaign.state === 'HIDDEN') notFound()
    // a campaign that has ended sends its old link to the home page
    if (campaign.state === 'ENDED') redirect(SITE_HOME)
    detail = { campaign }
  }
  if (page === 'solution') {
    const solution = content.solutions.items.find((s) => s.show !== false && slugify(s.title.en) === slug)
    if (!solution) notFound()
    detail = { solution }
  }
  if (page === 'achievement') {
    const item = items.find((i) => i.kind === 'ACHIEVEMENT' && i.id === id)
    if (!item) notFound()
    detail = { item }
  }
  return <>{page === 'home' ? <OrgJsonLd C={content} /> : null}<SiteHome content={content} items={items} stats={stats} preview={!SITE_LIVE} page={page} detail={detail} courses={courses} banner={page === 'campaign' ? null : banner} fontClass={siteFontClass} /></>
}
