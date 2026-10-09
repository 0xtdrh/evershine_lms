'use client'

/**
 * LMS L1: shows one curriculum content block (used by the editor preview, and later by the instructor / student
 * session pages). Markdown is rendered WITHOUT raw HTML (react-markdown default), so lesson text cannot run scripts.
 * Media comes as a signed link made by the server; video download / right-click is switched off.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useI18n } from '@/lib/i18n/client'
import { videoEmbedUrl } from '@/lib/curriculum/blocks'
import { Watermark } from './Watermark'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Hourglass, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'

export interface Block {
  id: string; type: string; audience: string; titleEn: string | null; titleAr: string | null
  data: Record<string, unknown> & { mediaUrl?: string }
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-700 [&_a]:text-indigo-600 [&_a]:underline [&_blockquote]:border-s-4 [&_blockquote]:border-slate-200 [&_blockquote]:ps-3 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ms-5 [&_ol]:list-decimal [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:p-1 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-1 [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

const noMenu = (e: React.MouseEvent) => e.preventDefault()

const FILL_TYPES = ['VIDEO', 'EMBED', 'FILE']
const ZOOM_TYPES = ['TEXT', 'CODE', 'IMAGE']

export function BlockView({ block, watermark }: { block: Block; watermark?: string | null }) {
  const { pick, t } = useI18n()
  const [full, setFull] = useState(false)
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const d = block.data
  const title = pick(block.titleEn, block.titleAr)

  const open = () => {
    setZoom(1)
    setFull(true)
    // real full screen where the browser allows it (iPhone falls back to the full-page view)
    requestAnimationFrame(() => { box.current?.requestFullscreen?.().catch(() => undefined) })
  }
  const close = () => {
    setFull(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
  }
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onFs = () => { if (!document.fullscreenElement) setFull(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); document.body.style.overflow = '' }
  }, [full])

  const fill = full && FILL_TYPES.includes(block.type)
  let body: React.ReactNode = null
  switch (block.type) {
    case 'TEXT':
      body = <Markdown text={pick(d.textEn as string, d.textAr as string)} />
      break
    case 'IMAGE':
      body = d.mediaUrl ? (
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.mediaUrl} alt={title || ''} className={`rounded-lg border border-slate-100 ${full ? 'mx-auto max-h-[85vh]' : 'max-h-[480px] cursor-zoom-in'}`} onClick={full ? undefined : open} onContextMenu={noMenu} draggable={false} />
          {(d.captionEn || d.captionAr) && <figcaption className="text-xs text-slate-500">{pick(d.captionEn as string, d.captionAr as string)}</figcaption>}
        </figure>
      ) : <p className="text-xs text-slate-400">Image not available</p>
      break
    case 'VIDEO': {
      const embed = d.url ? videoEmbedUrl(d.url as string) : null
      body = d.mediaUrl ? (
        <video src={d.mediaUrl} controls controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={noMenu} className={`rounded-lg bg-black ${fill ? 'h-full w-full' : 'w-full max-w-3xl'}`} />
      ) : embed ? (
        <div className={`overflow-hidden rounded-lg ${fill ? 'h-full w-full' : 'aspect-video w-full max-w-3xl'}`}><iframe src={embed} className="h-full w-full" allow="encrypted-media; fullscreen" allowFullScreen title={title || 'video'} /></div>
      ) : <p className="text-xs text-slate-400">Video not available</p>
      break
    }
    case 'FILE': {
      const m = { ...(d.media as { originalName?: string; format?: string } | undefined), ...(d.mediaFormat ? { format: d.mediaFormat as string } : {}) }
      const name = m?.originalName || title || 'File'
      body = d.mediaUrl ? (
        m?.format === 'pdf' && !d.downloadable
          ? <iframe src={`${d.mediaUrl}#toolbar=0`} className={`w-full rounded-lg border border-slate-200 ${fill ? 'h-full' : 'h-[560px]'}`} title={name} />
          : <a href={d.mediaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4" /> {name}</a>
      ) : <p className="text-xs text-slate-400">File not available</p>
      break
    }
    case 'LINK':
      body = <a href={d.url as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-600 underline"><ExternalLink className="h-4 w-4" /> {title || (d.url as string)}</a>
      break
    case 'CODE':
      body = <pre dir="ltr" className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code>{d.code as string}</code></pre>
      break
    case 'EMBED':
      body = <iframe src={d.url as string} style={fill ? undefined : { height: Number(d.height) || 480 }} className={`w-full rounded-lg border border-slate-200 ${fill ? 'h-full' : ''}`} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" allow="fullscreen" allowFullScreen title={title || 'embed'} />
      break
    default:
      body = <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500"><Hourglass className="h-4 w-4" /> {block.type} — {t('cur.coming')}</p>
  }
  const canExpand = !['LINK', 'H5P', 'QUIZ', 'ASSIGNMENT', 'TOOL'].includes(block.type) && !(block.type === 'FILE' && ((d.media as { format?: string } | undefined)?.format ?? d.mediaFormat) !== 'pdf')
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'

  if (full) {
    return (
      <div ref={box} className="fixed inset-0 z-[100] flex flex-col bg-white" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
          <span className="truncate font-semibold text-slate-800">{title}</span>
          <span className="flex items-center gap-1">
            {ZOOM_TYPES.includes(block.type) && (
              <>
                <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))} aria-label="Smaller"><ZoomOut className="h-4 w-4" /></button>
                <span className="w-12 text-center text-xs text-slate-500">{Math.round(zoom * 100)}%</span>
                <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Bigger"><ZoomIn className="h-4 w-4" /></button>
              </>
            )}
            <button type="button" className={btn} onClick={close} aria-label="Close"><X className="h-4 w-4" /></button>
          </span>
        </div>
        <div className={`flex-1 overflow-auto p-4 ${fill ? 'flex' : ''}`}>
          <div className={fill ? 'flex-1' : 'mx-auto max-w-5xl text-base'} style={ZOOM_TYPES.includes(block.type) ? { zoom } : undefined}><div className={`relative ${fill ? 'h-full' : ''}`}>{body}{watermark && <Watermark text={watermark} moving={FILL_TYPES.includes(block.type)} />}</div></div>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {(title && block.type !== 'LINK') || canExpand ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-800">{block.type !== 'LINK' ? title : ''}</h3>
          {canExpand && <button type="button" className={btn} onClick={open} aria-label="Full screen" title="Full screen"><Maximize2 className="h-4 w-4" /></button>}
        </div>
      ) : null}
      <div className="relative">{body}{watermark && <Watermark text={watermark} moving={FILL_TYPES.includes(block.type)} />}</div>
    </div>
  )
}
