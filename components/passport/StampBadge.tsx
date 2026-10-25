'use client'

/**
 * P1: one passport stamp drawn as SVG (round / square / hex, its colour, icon, name, label, date). The same drawing is
 * turned into a PNG for the WhatsApp / stories image (17) and a high-resolution file for a real rubber stamp (18).
 */

export interface StampLook { nameEn: string; nameAr: string; icon: string; shape: string; color: string; label?: string | null; date?: string | Date | null }

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The stamp as an SVG string (used on screen and for the images). */
export function stampSvg(s: StampLook, ar: boolean, opts: { mono?: boolean } = {}): string {
  const c = opts.mono ? '#000000' : s.color
  const name = esc((ar ? s.nameAr : s.nameEn) || s.nameEn).slice(0, 40)
  const label = s.label ? esc(String(s.label)).slice(0, 34) : ''
  const date = s.date ? new Date(s.date).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const outline = s.shape === 'SQUARE'
    ? `<rect x="14" y="14" width="172" height="172" rx="22" fill="none" stroke="${c}" stroke-width="7"/><rect x="26" y="26" width="148" height="148" rx="14" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>`
    : s.shape === 'HEX'
      ? `<polygon points="100,10 178,55 178,145 100,190 22,145 22,55" fill="none" stroke="${c}" stroke-width="7"/><polygon points="100,26 164,63 164,137 100,174 36,137 36,63" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>`
      : `<circle cx="100" cy="100" r="88" fill="none" stroke="${c}" stroke-width="7"/><circle cx="100" cy="100" r="74" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${outline}
<text x="100" y="${label ? 84 : 92}" font-size="46" text-anchor="middle" dominant-baseline="middle">${esc(s.icon || '★')}</text>
<text x="100" y="${label ? 122 : 130}" font-size="14" font-weight="700" fill="${c}" text-anchor="middle" font-family="Arial, sans-serif">${name}</text>
${label ? `<text x="100" y="140" font-size="11" fill="${c}" text-anchor="middle" font-family="Arial, sans-serif">${label}</text>` : ''}
${date ? `<text x="100" y="${label ? 157 : 150}" font-size="10" fill="${c}" text-anchor="middle" font-family="Arial, sans-serif">${esc(date)}</text>` : ''}
<text x="100" y="${s.shape === 'HEX' ? 176 : 180}" font-size="8" letter-spacing="2" fill="${c}" text-anchor="middle" font-family="Arial, sans-serif">TECHNOVA</text></svg>`
}

export function StampBadge({ stamp, ar, size = 120, isNew = false }: { stamp: StampLook; ar: boolean; size?: number; isNew?: boolean }) {
  return (
    <div className={isNew ? 'animate-[stampIn_0.9s_ease-out]' : ''} style={{ width: size, height: size, transform: 'rotate(-6deg)' }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: stampSvg(stamp, ar) }} />
  )
}

/** SVG → PNG (data URL) at a given size, optionally with a frame for sharing (logo, name, line of text). */
export async function stampPng(stamp: StampLook, ar: boolean, opts: { size?: number; mono?: boolean; share?: { title: string; line: string } } = {}): Promise<string> {
  const size = opts.size ?? 1200
  const svg = stampSvg(stamp, ar, { mono: opts.mono })
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
  const canvas = document.createElement('canvas')
  if (!opts.share) {
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!
    if (!opts.mono) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size) }
    ctx.drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  }
  // 1080 × 1350 story / WhatsApp image
  canvas.width = 1080; canvas.height = 1350
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 1350)
  g.addColorStop(0, '#0f172a'); g.addColorStop(1, '#1e3a8a')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350)
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(540, 600, 360, 0, Math.PI * 2); ctx.fill()
  ctx.save(); ctx.translate(540, 600); ctx.rotate(-0.1); ctx.drawImage(img, -320, -320, 640, 640); ctx.restore()
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'
  ctx.font = 'bold 64px Arial'; ctx.fillText(opts.share.title, 540, 160)
  ctx.font = '40px Arial'; ctx.fillText(opts.share.line, 540, 1080)
  try {
    const logo = new Image(); logo.src = '/brand/bglogo.png'
    await new Promise((res, rej) => { logo.onload = res; logo.onerror = rej })
    const h = 110, w = (logo.width / logo.height) * h
    ctx.drawImage(logo, 540 - w / 2, 1180, w, h)
  } catch { ctx.font = 'bold 48px Arial'; ctx.fillText('TechNova', 540, 1250) }
  return canvas.toDataURL('image/png')
}
