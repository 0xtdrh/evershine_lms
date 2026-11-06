/**
 * Security batch (2026-11-06): the signing secret. On the live site a missing secret stops the action instead of falling back to a
 * known word (a forged attendance QR or file link would be possible with it). Only tests and the local copy get a fixed dev value.
 */

export function signingSecret(): string {
  const s = (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || '').trim()
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET / NEXTAUTH_SECRET is not set')
  return 'dev-only-secret'
}
