/**
 * Private storage for CVs sent with the public job-application form.
 * Server-only.
 *
 * WHY: CVs used to be written to public/uploads/staff-cv/ — downloadable by
 * anyone on Hostinger (personal data), and failing on Vercel (read-only disk).
 * Now they go to Cloudinary as "authenticated" raw files (like the backups):
 * no public URL exists; staff open them through /api/staff-applications/[id]/cv,
 * which checks the permission and redirects to a 2-minute signed link.
 */

import { randomBytes } from 'crypto'
import cloudinary, { getBaseUploadFolder } from '@/lib/cloudinary'

const RAW_AUTH = { resource_type: 'raw', type: 'authenticated' } as const
/** Stored in StaffApplication.cvDocUrl instead of a public path. */
export const PRIVATE_CV_PREFIX = 'cloudinary-private:'

export async function uploadPrivateCv(pdf: Buffer): Promise<string> {
  const publicId = `${getBaseUploadFolder()}/staff-cv/cv-${Date.now()}-${randomBytes(8).toString('hex')}.pdf`
  const result = await new Promise<{ public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { ...RAW_AUTH, public_id: publicId, overwrite: false, use_filename: false, unique_filename: false },
      (error, res) => (error || !res ? reject(error ?? new Error('Empty Cloudinary response')) : resolve(res))
    )
    stream.end(pdf)
  })
  return PRIVATE_CV_PREFIX + result.public_id
}

/** 2-minute signed download link for a stored private CV, or null if not private. */
export function privateCvDownloadUrl(cvDocUrl: string | null | undefined): string | null {
  if (!cvDocUrl?.startsWith(PRIVATE_CV_PREFIX)) return null
  const publicId = cvDocUrl.slice(PRIVATE_CV_PREFIX.length)
  return cloudinary.utils.private_download_url(publicId, '', {
    ...RAW_AUTH,
    attachment: true,
    expires_at: Math.floor(Date.now() / 1000) + 120,
  })
}
