/**
 * Security review part 1 (23/11): `z.string().url()` also accepts `javascript:…` and `data:…` links. A link like that,
 * saved by a staff member (announcement attachment, document, credential file…) and shown to a parent as a button,
 * would run code in the parent's browser. Every link a person types is checked with these instead: http(s) only.
 */

import { z } from 'zod'

export const isWebUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v.trim())

/** A web link (http:// or https://). */
export const webUrl = z.string().trim().max(1000).url().refine(isWebUrl, 'Links must start with http:// or https:// · اللينك لازم يبدأ بـ https://')

/** For showing a stored link: anything that is not a web link (old rows, typed by hand) is dropped. */
export const safeHref = (v: string | null | undefined): string | undefined => (v && isWebUrl(v) ? v.trim() : undefined)
