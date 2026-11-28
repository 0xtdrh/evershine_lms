'use client'

/**
 * Owner 28/11 (S49): a stamp or a signature photographed on white paper → a PNG whose white is see-through, so it sits
 * on the passport paper like real ink. Runs in the browser before the upload; keeps the picture at most 1200 px wide.
 * Light pixels fade out smoothly (no hard edge); a picture that has no white around it is returned as it is.
 */
export async function removeWhiteBackground(file: File, opts: { cutoff?: number; soft?: number } = {}): Promise<File> {
  const cutoff = opts.cutoff ?? 215 // brighter than this → fully see-through
  const soft = opts.soft ?? 45      // the band below it fades out
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    const px = data.data
    let cleared = 0
    for (let i = 0; i < px.length; i += 4) {
      const light = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      if (light >= cutoff) { px[i + 3] = 0; cleared++ }
      else if (light > cutoff - soft) px[i + 3] = Math.round(px[i + 3] * ((cutoff - light) / soft))
    }
    if (cleared < (w * h) / 10) return file // not a photo on white paper
    ctx.putImageData(data, 0, 0)
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/png'))
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' }) : file
  } finally {
    URL.revokeObjectURL(url)
  }
}
