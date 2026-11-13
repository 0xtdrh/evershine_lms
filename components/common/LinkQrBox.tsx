'use client'

/**
 * Six phases 1-C: a link to share — copy, send on WhatsApp, and a QR to print or download (partner join links, group booking
 * links). The QR is drawn in the browser (qrcode), so nothing leaves the page.
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'

export function LinkQrBox({ path, whatsappText, fileName }: { path: string; whatsappText: string; fileName: string }) {
  const [url, setUrl] = useState(path)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    const full = `${window.location.origin}${path}`
    setUrl(full)
    QRCode.toDataURL(full, { margin: 1, width: 360 }).then(setQr).catch(() => setQr(null))
  }, [path])
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-xl border border-slate-200 bg-white p-3">
      {qr ? <img src={qr} alt={L('QR code of the link', 'QR اللينك')} width={140} height={140} className="rounded-lg border border-slate-100 keep-light" /> : null}
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="break-all font-mono text-xs" dir="ltr">{url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(url); notify.success(L('Copied', 'اتنسخ')) }} className="rounded-lg border border-slate-300 px-3 py-1.5">{L('Copy', 'انسخ')}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${whatsappText}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white">{L('Share on WhatsApp', 'ابعت واتساب')}</a>
          {qr ? <a href={qr} download={`${fileName}.png`} className="rounded-lg border border-slate-300 px-3 py-1.5">{L('Download the QR', 'نزّل الـ QR')}</a> : null}
        </div>
      </div>
    </div>
  )
}
