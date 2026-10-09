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
import { ExternalLink, FileText, Hourglass } from 'lucide-react'

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

export function BlockView({ block }: { block: Block }) {
  const { pick, t } = useI18n()
  const d = block.data
  const title = pick(block.titleEn, block.titleAr)
  let body: React.ReactNode = null
  switch (block.type) {
    case 'TEXT':
      body = <Markdown text={pick(d.textEn as string, d.textAr as string)} />
      break
    case 'IMAGE':
      body = d.mediaUrl ? (
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.mediaUrl} alt={title || ''} className="max-h-[480px] rounded-lg border border-slate-100" onContextMenu={noMenu} draggable={false} />
          {(d.captionEn || d.captionAr) && <figcaption className="text-xs text-slate-500">{pick(d.captionEn as string, d.captionAr as string)}</figcaption>}
        </figure>
      ) : <p className="text-xs text-slate-400">Image not available</p>
      break
    case 'VIDEO': {
      const embed = d.url ? videoEmbedUrl(d.url as string) : null
      body = d.mediaUrl ? (
        <video src={d.mediaUrl} controls controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={noMenu} className="w-full max-w-3xl rounded-lg bg-black" />
      ) : embed ? (
        <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-lg"><iframe src={embed} className="h-full w-full" allow="encrypted-media; fullscreen" allowFullScreen title={title || 'video'} /></div>
      ) : <p className="text-xs text-slate-400">Video not available</p>
      break
    }
    case 'FILE': {
      const m = d.media as { originalName?: string; format?: string } | undefined
      const name = m?.originalName || title || 'File'
      body = d.mediaUrl ? (
        m?.format === 'pdf' && !d.downloadable
          ? <iframe src={`${d.mediaUrl}#toolbar=0`} className="h-[560px] w-full rounded-lg border border-slate-200" title={name} />
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
      body = <iframe src={d.url as string} style={{ height: Number(d.height) || 480 }} className="w-full rounded-lg border border-slate-200" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" allow="fullscreen" title={title || 'embed'} />
      break
    default:
      body = <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500"><Hourglass className="h-4 w-4" /> {block.type} — {t('cur.coming')}</p>
  }
  return (
    <div className="space-y-2">
      {title && block.type !== 'LINK' && <h3 className="font-semibold text-slate-800">{title}</h3>}
      {body}
    </div>
  )
}
