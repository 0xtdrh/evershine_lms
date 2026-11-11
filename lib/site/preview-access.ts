/**
 * x01: who may open the new website preview (/new-home) before the owner approves it.
 * On the owner's own computer (localhost) anyone may; on a real domain only a Super Admin / Admin. Pure (edge-safe).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false
  const name = host.toLowerCase().replace(/:\d+$/, '')
  return LOCAL_HOSTS.has(name) || name.endsWith('.localhost')
}

export function canOpenSitePreview(host: string | null | undefined, role: string | null | undefined): boolean {
  return isLocalHost(host) || role === 'SUPER_ADMIN' || role === 'ADMIN'
}
