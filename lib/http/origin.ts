/**
 * The address the visitor used (https://technovafuture.com), for redirects built on the server. Pure.
 *
 * WHY: behind a reverse proxy (Coolify / Traefik / Nginx on a VPS) or in `next start` with the standalone server,
 * `request.nextUrl.origin` is the server's own bind address (http://0.0.0.0:3000), so a redirect from a QR or a partner
 * link sent the visitor to a dead address. Order: the proxy's forwarded host, the Host header, the configured public URL,
 * and only then the request's own origin. (Final test C14, 20/11.)
 */
export function publicOrigin(headers: { get(name: string): string | null }, fallbackOrigin: string, env: Record<string, string | undefined> = {}): string {
  const first = (v: string | null) => (v ?? '').split(',')[0].trim()
  const fwdHost = first(headers.get('x-forwarded-host'))
  const host = fwdHost || first(headers.get('host'))
  const bad = (h: string) => !h || /^(0\.0\.0\.0|\[::\])(:\d+)?$/.test(h)
  if (!bad(host)) {
    const proto = first(headers.get('x-forwarded-proto')) || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https')
    if (/^[a-z0-9.\-]+(:\d+)?$/i.test(host)) return `${proto === 'http' ? 'http' : 'https'}://${host}`
  }
  const configured = (env.AUTH_URL || env.NEXTAUTH_URL || env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\/[^\s/]+$/.test(configured)) return configured
  return fallbackOrigin
}
