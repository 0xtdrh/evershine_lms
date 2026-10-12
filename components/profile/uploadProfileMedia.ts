/** P2: uploads a project photo / short video to the student's private profile folder (server signature first). */

import { fetchApi } from '@/lib/api-client'

interface Sign { timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }
export interface ProfileMedia { publicId: string; resourceType: 'image' | 'video'; format?: string; bytes?: number; duration?: number }

export async function uploadProfileMedia(studentId: string, file: File, forMoment = false): Promise<ProfileMedia> {
  const s = await fetchApi<Sign>(`/api/profile/${studentId}`, { method: 'POST', body: JSON.stringify({ action: 'sign', forMoment }) })
  const fd = new FormData()
  fd.append('file', file); fd.append('api_key', s.apiKey); fd.append('timestamp', String(s.timestamp)); fd.append('signature', s.signature)
  fd.append('folder', s.folder); fd.append('allowed_formats', s.allowedFormats); fd.append('type', s.type)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd })
  const j = await res.json()
  if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
  return { publicId: j.public_id, resourceType: j.resource_type, format: j.format, bytes: j.bytes, duration: j.duration }
}
