/**
 * Backup storage on Cloudinary.
 *
 * Files are uploaded as `resource_type: raw`, `type: authenticated`: there is no
 * public URL, and a download needs a short-lived signed link that only the
 * SUPER_ADMIN-only route generates.
 *
 * Limits (Cloudinary free plan): 10 MB per raw file. The dump is gzipped; if it
 * ever gets close to that, move storage to Vercel Blob or R2.
 */

import cloudinary from '@/lib/cloudinary'

export const BACKUP_FOLDER = 'technova-backups'
export const BACKUPS_TO_KEEP = 7
export const MAX_BACKUP_BYTES = 9.5 * 1024 * 1024

const BACKUP_ID_PATTERN = /^technova-backups\/technova-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-manual)?\.sql\.gz$/

const RAW_AUTH = { resource_type: 'raw', type: 'authenticated' } as const

export interface StoredBackup {
  id: string
  fileName: string
  bytes: number
  createdAt: string
}

export function isBackupId(id: string) {
  return BACKUP_ID_PATTERN.test(id)
}

export function backupFileName(createdAt: Date, manual: boolean) {
  const stamp = createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
  return `technova-${stamp}${manual ? '-manual' : ''}.sql.gz`
}

export async function uploadBackup(gz: Buffer, fileName: string): Promise<StoredBackup> {
  if (gz.length > MAX_BACKUP_BYTES) {
    throw new Error(`Backup is ${(gz.length / 1024 / 1024).toFixed(1)} MB, over the Cloudinary limit. Storage must be moved.`)
  }

  const result = await new Promise<{ public_id: string; bytes: number; created_at: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        ...RAW_AUTH,
        public_id: `${BACKUP_FOLDER}/${fileName}`,
        overwrite: false,
        use_filename: false,
        unique_filename: false,
      },
      (error, res) => (error || !res ? reject(error ?? new Error('Empty Cloudinary response')) : resolve(res))
    )
    stream.end(gz)
  })

  return {
    id: result.public_id,
    fileName: result.public_id.slice(BACKUP_FOLDER.length + 1),
    bytes: result.bytes,
    createdAt: result.created_at,
  }
}

export async function listBackups(): Promise<StoredBackup[]> {
  const res = await cloudinary.api.resources({
    ...RAW_AUTH,
    prefix: `${BACKUP_FOLDER}/`,
    max_results: 100,
  })
  const items = (res.resources ?? []) as Array<{ public_id: string; bytes: number; created_at: string }>
  return items
    .filter((r) => isBackupId(r.public_id))
    .map((r) => ({
      id: r.public_id,
      fileName: r.public_id.slice(BACKUP_FOLDER.length + 1),
      bytes: r.bytes,
      createdAt: r.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Keeps the newest `keep` backups, deletes the rest. Returns deleted ids. */
export async function pruneBackups(keep = BACKUPS_TO_KEEP): Promise<string[]> {
  const all = await listBackups()
  const toDelete = all.slice(keep).map((b) => b.id)
  if (toDelete.length) {
    await cloudinary.api.delete_resources(toDelete, RAW_AUTH)
  }
  return toDelete
}

/** Signed download link, valid for 2 minutes. */
export function signedDownloadUrl(id: string) {
  if (!isBackupId(id)) throw new Error('Invalid backup id')
  return cloudinary.utils.private_download_url(id, '', {
    ...RAW_AUTH,
    attachment: true,
    expires_at: Math.floor(Date.now() / 1000) + 120,
  })
}
