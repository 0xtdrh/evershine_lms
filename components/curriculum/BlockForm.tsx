'use client'

/** LMS L1: add / edit form of one curriculum content block (type-specific fields + upload to private Cloudinary). */

import { useState } from 'react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { COMING_TYPES, EMBED_HOSTS, type BlockType } from '@/lib/curriculum/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Upload } from 'lucide-react'
import { Markdown } from './BlockView'

interface Sign { timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }
export interface Media { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string; bytes?: number; originalName?: string }

const MAX_MB = 100

/** Uploads one file straight to Cloudinary (private) with a server signature. */
export async function uploadCurriculumFile(file: File): Promise<Media> {
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`The file is larger than ${MAX_MB} MB`)
  const s = await fetchApi<Sign>('/api/curriculum/media/sign', { method: 'POST' })
  const fd = new FormData()
  fd.append('file', file)
  fd.append('api_key', s.apiKey)
  fd.append('timestamp', String(s.timestamp))
  fd.append('signature', s.signature)
  fd.append('folder', s.folder)
  fd.append('allowed_formats', s.allowedFormats)
  fd.append('type', s.type)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd })
  const j = await res.json()
  if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
  return { publicId: j.public_id, resourceType: j.resource_type, format: j.format, bytes: j.bytes, originalName: file.name.slice(0, 200) }
}

export interface BlockDraft { type: BlockType; audience: string; titleEn: string; titleAr: string; data: Record<string, unknown> }

export const TYPE_LABELS: Record<BlockType, string> = {
  TEXT: 'Text', IMAGE: 'Image', VIDEO: 'Video', FILE: 'File / PDF', LINK: 'Link', CODE: 'Code', EMBED: 'Embedded tool',
  H5P: 'Interactive (H5P)', QUIZ: 'Quiz', ASSIGNMENT: 'Assignment', TOOL: 'Code editor / tool',
}

export function blankData(type: BlockType): Record<string, unknown> {
  if (type === 'TEXT') return { textEn: '', textAr: '' }
  if (type === 'CODE') return { language: 'python', code: '' }
  if (type === 'EMBED') return { url: '', height: 480 }
  if (type === 'LINK') return { url: '' }
  if (type === 'FILE') return { downloadable: false }
  return {}
}

const area = 'min-h-[160px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm'

export function BlockForm({ value, onChange }: { value: BlockDraft; onChange: (v: BlockDraft) => void }) {
  const [uploading, setUploading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const d = value.data
  const set = (patch: Record<string, unknown>) => onChange({ ...value, data: { ...d, ...patch } })
  const media = d.media as Media | undefined

  const pickFile = async (accept: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      setUploading(true)
      try { set({ media: await uploadCurriculumFile(f) }); notify.success('Uploaded') } catch (e) { notify.error((e as Error).message) } finally { setUploading(false) }
    }
    input.click()
  }
  const uploadBtn = (accept: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="gap-1" disabled={uploading} onClick={() => pickFile(accept)}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {media ? 'Replace file' : 'Upload file'}
      </Button>
      {media && <span className="text-xs text-slate-500">{media.originalName ?? media.publicId} {media.bytes ? `· ${(media.bytes / 1024 / 1024).toFixed(1)} MB` : ''}</span>}
    </div>
  )

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1"><span className="text-xs text-slate-500">Title (English, optional)</span><Input value={value.titleEn} onChange={(e) => onChange({ ...value, titleEn: e.target.value })} /></label>
        <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">العنوان (عربي، اختياري)</span><Input value={value.titleAr} onChange={(e) => onChange({ ...value, titleAr: e.target.value })} /></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Who sees it</span>
          <Select value={value.audience} onValueChange={(a) => onChange({ ...value, audience: a })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="BOTH">Instructor + students</SelectItem>
              <SelectItem value="INSTRUCTOR">Instructor only</SelectItem>
              <SelectItem value="STUDENT">Students only</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {value.type === 'TEXT' && (
        <>
          <div className="flex justify-between text-xs text-slate-500"><span>Markdown: **bold**, # heading, - list, [link](https://…), tables.</span><button type="button" className="text-indigo-600" onClick={() => setShowPreview(!showPreview)}>{showPreview ? 'Edit' : 'Preview'}</button></div>
          {showPreview ? (
            <div className="grid gap-3 sm:grid-cols-2"><Markdown text={(d.textEn as string) || ''} /><div dir="rtl"><Markdown text={(d.textAr as string) || ''} /></div></div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <textarea className={area} placeholder="English" value={(d.textEn as string) ?? ''} onChange={(e) => set({ textEn: e.target.value })} />
              <textarea className={area} dir="rtl" placeholder="عربي" value={(d.textAr as string) ?? ''} onChange={(e) => set({ textAr: e.target.value })} />
            </div>
          )}
        </>
      )}
      {value.type === 'IMAGE' && (
        <>
          {uploadBtn('image/*')}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Caption (English)" value={(d.captionEn as string) ?? ''} onChange={(e) => set({ captionEn: e.target.value })} />
            <Input dir="rtl" placeholder="التعليق (عربي)" value={(d.captionAr as string) ?? ''} onChange={(e) => set({ captionAr: e.target.value })} />
          </div>
        </>
      )}
      {value.type === 'VIDEO' && (
        <>
          <p className="text-xs text-slate-500">Upload a video (private, max {MAX_MB} MB) <b>or</b> paste a YouTube / Vimeo link.</p>
          {uploadBtn('video/*')}
          <Input placeholder="https://www.youtube.com/watch?v=…" value={(d.url as string) ?? ''} onChange={(e) => set({ url: e.target.value || undefined })} />
        </>
      )}
      {value.type === 'FILE' && (
        <>
          {uploadBtn('.pdf,.pptx,.docx,.xlsx,.zip,.ino,.py,.sb3,.stl,.mp3,.wav')}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!d.downloadable} onChange={(e) => set({ downloadable: e.target.checked })} /> Allow download (otherwise a PDF opens inside the page only)</label>
        </>
      )}
      {value.type === 'LINK' && <Input placeholder="https://…" value={(d.url as string) ?? ''} onChange={(e) => set({ url: e.target.value })} />}
      {value.type === 'CODE' && (
        <>
          <Select value={(d.language as string) ?? 'python'} onValueChange={(l) => set({ language: l })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{['python', 'cpp', 'arduino', 'javascript', 'html', 'css', 'java', 'text'].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <textarea dir="ltr" className={`${area} font-mono text-xs`} value={(d.code as string) ?? ''} onChange={(e) => set({ code: e.target.value })} />
        </>
      )}
      {value.type === 'EMBED' && (
        <>
          <Input placeholder="https://scratch.mit.edu/projects/…/embed" value={(d.url as string) ?? ''} onChange={(e) => set({ url: e.target.value })} />
          <label className="flex items-center gap-2 text-xs">Height (px) <Input type="number" className="h-8 w-24" value={Number(d.height) || 480} onChange={(e) => set({ height: Number(e.target.value) || 480 })} /></label>
          <p className="text-xs text-slate-400">Allowed sites: {EMBED_HOSTS.join(', ')}</p>
        </>
      )}
      {COMING_TYPES.includes(value.type) && (
        <>
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">This type is built in a later stage. You can add a placeholder now (with a note) and fill it later.</p>
          <Input placeholder="Note" value={(d.note as string) ?? ''} onChange={(e) => set({ note: e.target.value })} />
        </>
      )}
    </div>
  )
}
