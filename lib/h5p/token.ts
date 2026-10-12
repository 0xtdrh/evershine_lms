/**
 * L5: short-lived signed token in the H5P file links. The player runs in a sandboxed frame (no access to our cookies),
 * so its file requests carry this token instead: block + viewer + expiry, HMAC with the auth secret. Pure + node crypto.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const secret = () => process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-secret'
const b64 = (s: Buffer | string) => Buffer.from(s).toString('base64url')

export const H5P_TOKEN_HOURS = 6

export function signH5pToken(blockId: string, viewer: string, now = Date.now(), hours = H5P_TOKEN_HOURS): string {
  const exp = Math.floor(now / 1000) + hours * 3600
  const body = `${blockId}.${viewer}.${exp}`
  const mac = createHmac('sha256', secret()).update(body).digest()
  return `${b64(viewer)}.${exp}.${b64(mac)}`
}

/** The viewer id when the token is valid for this block and not expired, else null. */
export function verifyH5pToken(token: string, blockId: string, now = Date.now()): string | null {
  const [v, expS, mac] = token.split('.')
  if (!v || !expS || !mac || !/^\d+$/.test(expS)) return null
  if (Number(expS) * 1000 < now) return null
  let viewer: string
  try { viewer = Buffer.from(v, 'base64url').toString() } catch { return null }
  const want = createHmac('sha256', secret()).update(`${blockId}.${viewer}.${expS}`).digest()
  const got = Buffer.from(mac, 'base64url')
  return got.length === want.length && timingSafeEqual(got, want) ? viewer : null
}
