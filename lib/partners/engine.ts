/**
 * M1 partners — database side: partners, their places (Campus kind PARTNER), contracts + private files, the daily
 * contract alert. Server-only. Pure rules in ./rules.ts. docs/design-locations-and-partners.md §3 (م١) + §11.
 */

import type { Prisma } from '@prisma/client'
import cloudinary, { generateAuthenticatedUploadSignature, getBaseUploadFolder } from '@/lib/cloudinary'
import { prisma } from '@/lib/prisma'
import { defaultBatchId } from '@/lib/batches/default-batch'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { CONTRACT_FILE_FORMATS, CONTRACT_FILE_MAX_MB, contractAlertDue, contractProblem, contractState, daysLeft, placeCode } from './rules'

type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT'; message: string }
const fail = (code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT', message: string): Outcome<never> => ({ ok: false, code, message })

export const contractFolder = (partnerId: string) => `${getBaseUploadFolder()}/partners/${partnerId}`

async function audit(userId: string, action: string, entityType: string, entityId: string, changes?: unknown) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entityType, entityId, changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined } })
  } catch (err) {
    console.error('[PARTNER_AUDIT]', err)
  }
}

// ───────────────────────── partners ─────────────────────────

export async function listPartners(now = new Date()) {
  const rows = await prisma.partner.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      places: { select: { id: true, name: true, isActive: true } },
      contracts: { select: { id: true, title: true, startDate: true, endDate: true, alertDaysBefore: true }, orderBy: { startDate: 'desc' } },
    },
  })
  const groups = await prisma.classSection.groupBy({ by: ['campusId'], where: { campusId: { in: rows.flatMap((r) => r.places.map((p) => p.id)) }, status: 'ACTIVE', isActive: true }, _count: { _all: true } })
  const G = new Map(groups.map((g) => [g.campusId, g._count._all]))
  return rows.map((p) => {
    const current = p.contracts.find((c) => ['ACTIVE', 'ENDING_SOON', 'OPEN_ENDED'].includes(contractState(c, now))) ?? p.contracts[0] ?? null
    return {
      id: p.id, name: p.name, kind: p.kind, contactName: p.contactName, contactPhone: p.contactPhone, isActive: p.isActive,
      places: p.places.length, activeGroups: p.places.reduce((n, pl) => n + (G.get(pl.id) ?? 0), 0),
      contract: current ? { id: current.id, title: current.title, endDate: current.endDate, state: contractState(current, now), daysLeft: daysLeft(current.endDate, now) } : null,
    }
  })
}

export async function getPartner(id: string, now = new Date()) {
  const p = await prisma.partner.findUnique({
    where: { id },
    include: {
      places: { orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, address: true, phone: true, email: true, principalName: true, isActive: true } },
      contracts: { orderBy: { startDate: 'desc' }, include: { files: { orderBy: { createdAt: 'asc' }, select: { id: true, originalName: true, format: true, bytes: true, createdAt: true } } } },
    },
  })
  if (!p) return null
  const counts = await prisma.classSection.groupBy({ by: ['campusId'], where: { campusId: { in: p.places.map((x) => x.id) }, status: 'ACTIVE', isActive: true }, _count: { _all: true } })
  const students = await prisma.student.groupBy({ by: ['campusId'], where: { campusId: { in: p.places.map((x) => x.id) }, isActive: true }, _count: { _all: true } })
  const C = new Map(counts.map((c) => [c.campusId, c._count._all]))
  const S = new Map(students.map((c) => [c.campusId, c._count._all]))
  return {
    ...p,
    places: p.places.map((pl) => ({ ...pl, activeGroups: C.get(pl.id) ?? 0, students: S.get(pl.id) ?? 0 })),
    contracts: p.contracts.map((c) => ({ ...c, state: contractState(c, now), daysLeft: daysLeft(c.endDate, now) })),
  }
}

export interface PartnerInput { name: string; kind: string; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null; address?: string | null; notes?: string | null; isActive?: boolean }

export async function savePartner(userId: string, id: string | null, input: PartnerInput): Promise<Outcome<{ id: string }>> {
  const name = input.name.trim()
  const clash = await prisma.partner.findFirst({ where: { name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })
  if (clash) return fail('CONFLICT', 'A partner with this name already exists')
  const data = {
    name, kind: input.kind, contactName: input.contactName?.trim() || null, contactPhone: input.contactPhone?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null, address: input.address?.trim() || null, notes: input.notes?.trim() || null,
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }
  if (id) {
    const before = await prisma.partner.findUnique({ where: { id } })
    if (!before) return fail('NOT_FOUND', 'Partner not found')
    await prisma.partner.update({ where: { id }, data })
    // a stopped partner stops its places too (they can be switched on again one by one)
    if (input.isActive === false && before.isActive) await prisma.campus.updateMany({ where: { partnerId: id }, data: { isActive: false } })
    await audit(userId, 'UPDATE', 'Partner', id, { before: { name: before.name, kind: before.kind, isActive: before.isActive }, after: data })
    return { ok: true, value: { id } }
  }
  const created = await prisma.partner.create({ data: { ...data, createdById: userId } })
  await audit(userId, 'CREATE', 'Partner', created.id, data)
  return { ok: true, value: { id: created.id } }
}

/** Deletes a partner that has no places and no contracts yet; otherwise it must be stopped instead. */
export async function deletePartner(userId: string, id: string): Promise<Outcome> {
  const p = await prisma.partner.findUnique({ where: { id }, include: { _count: { select: { places: true, contracts: true } } } })
  if (!p) return fail('NOT_FOUND', 'Partner not found')
  if (p._count.places || p._count.contracts) return fail('CONFLICT', 'This partner has places or contracts — stop it instead of deleting')
  await prisma.partner.delete({ where: { id } })
  await audit(userId, 'DELETE', 'Partner', id, { name: p.name })
  return { ok: true, value: null }
}

// ───────────────────────── places ─────────────────────────

export interface PlaceInput { name: string; address?: string | null; phone?: string | null; email?: string | null; principalName?: string | null }

/** A new place of a partner: a Campus with kind PARTNER (its default batch is made too, like a branch). */
export async function addPlace(userId: string, partnerId: string, input: PlaceInput): Promise<Outcome<{ id: string }>> {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } })
  if (!partner) return fail('NOT_FOUND', 'Partner not found')
  const name = input.name.trim()
  if (await prisma.campus.findFirst({ where: { name }, select: { id: true } })) return fail('CONFLICT', 'A branch or place with this name already exists')
  const base = placeCode(partner.name, name)
  let code = base
  for (let i = 2; await prisma.campus.findFirst({ where: { code }, select: { id: true } }); i++) code = `${base}${i}`
  const campus = await prisma.campus.create({
    data: {
      name, code, kind: 'PARTNER', partnerId,
      address: input.address?.trim() || partner.address || '-',
      phone: input.phone?.trim() || partner.contactPhone || '-',
      email: input.email?.trim() || partner.contactEmail || '-',
      principalName: input.principalName?.trim() || partner.contactName || '-',
      isActive: partner.isActive,
    },
  })
  await defaultBatchId(campus.id)
  await audit(userId, 'CREATE', 'Campus', campus.id, { partnerId, name, code, kind: 'PARTNER' })
  return { ok: true, value: { id: campus.id } }
}

export async function updatePlace(userId: string, partnerId: string, placeId: string, input: PlaceInput & { isActive?: boolean }): Promise<Outcome> {
  const c = await prisma.campus.findFirst({ where: { id: placeId, partnerId } })
  if (!c) return fail('NOT_FOUND', 'Place not found')
  const name = input.name.trim()
  if (name !== c.name && (await prisma.campus.findFirst({ where: { name, id: { not: placeId } }, select: { id: true } }))) return fail('CONFLICT', 'A branch or place with this name already exists')
  const data = {
    name,
    ...(input.address !== undefined && { address: input.address?.trim() || '-' }),
    ...(input.phone !== undefined && { phone: input.phone?.trim() || '-' }),
    ...(input.email !== undefined && { email: input.email?.trim() || '-' }),
    ...(input.principalName !== undefined && { principalName: input.principalName?.trim() || '-' }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }
  await prisma.campus.update({ where: { id: placeId }, data })
  await audit(userId, 'UPDATE', 'Campus', placeId, data)
  return { ok: true, value: null }
}

// ───────────────────────── contracts ─────────────────────────

export interface ContractInput { title: string; startDate: string; endDate?: string | null; alertDaysBefore?: number; notes?: string | null }

function contractData(input: ContractInput) {
  const startDate = new Date(input.startDate)
  const endDate = input.endDate ? new Date(input.endDate) : null
  const alertDaysBefore = input.alertDaysBefore ?? 30
  return { data: { title: input.title.trim(), startDate, endDate, alertDaysBefore, notes: input.notes?.trim() || null }, problem: contractProblem({ startDate, endDate, alertDaysBefore }) }
}

export async function addContract(userId: string, partnerId: string, input: ContractInput): Promise<Outcome<{ id: string }>> {
  if (!(await prisma.partner.count({ where: { id: partnerId } }))) return fail('NOT_FOUND', 'Partner not found')
  const { data, problem } = contractData(input)
  if (problem) return fail('INVALID', problem)
  const c = await prisma.partnerContract.create({ data: { ...data, partnerId, createdById: userId } })
  await audit(userId, 'CREATE', 'PartnerContract', c.id, data)
  return { ok: true, value: { id: c.id } }
}

export async function updateContract(userId: string, contractId: string, input: ContractInput): Promise<Outcome> {
  const before = await prisma.partnerContract.findUnique({ where: { id: contractId } })
  if (!before) return fail('NOT_FOUND', 'Contract not found')
  const { data, problem } = contractData(input)
  if (problem) return fail('INVALID', problem)
  const datesChanged = (before.endDate?.getTime() ?? 0) !== (data.endDate?.getTime() ?? 0) || before.alertDaysBefore !== data.alertDaysBefore
  // a renewed / moved end date gets its alerts again
  await prisma.partnerContract.update({ where: { id: contractId }, data: { ...data, ...(datesChanged && { alertSentAt: null, endedNoticeAt: null }) } })
  await audit(userId, 'UPDATE', 'PartnerContract', contractId, { before: { title: before.title, startDate: before.startDate, endDate: before.endDate }, after: data })
  return { ok: true, value: null }
}

export async function deleteContract(userId: string, contractId: string): Promise<Outcome> {
  const c = await prisma.partnerContract.findUnique({ where: { id: contractId }, include: { files: true } })
  if (!c) return fail('NOT_FOUND', 'Contract not found')
  await prisma.partnerContract.delete({ where: { id: contractId } })
  for (const f of c.files) await destroyFile(f.publicId, f.resourceType)
  await audit(userId, 'DELETE', 'PartnerContract', contractId, { title: c.title, files: c.files.length })
  return { ok: true, value: null }
}

// ───────────────────────── contract files (private) ─────────────────────────

export function contractUploadSignature(partnerId: string) {
  return generateAuthenticatedUploadSignature(contractFolder(partnerId), CONTRACT_FILE_FORMATS)
}

export interface FileInput { publicId: string; resourceType: string; format?: string | null; bytes?: number | null; originalName?: string | null }

export async function addContractFile(userId: string, contractId: string, f: FileInput): Promise<Outcome<{ id: string }>> {
  const c = await prisma.partnerContract.findUnique({ where: { id: contractId }, select: { partnerId: true } })
  if (!c) return fail('NOT_FOUND', 'Contract not found')
  if (!f.publicId?.startsWith(`${contractFolder(c.partnerId)}/`)) return fail('INVALID', 'The file is not in the right place')
  if (f.resourceType !== 'image' && f.resourceType !== 'raw') return fail('INVALID', 'Only photos or PDF')
  if ((f.bytes ?? 0) > CONTRACT_FILE_MAX_MB * 1024 * 1024) return fail('INVALID', `The file is larger than ${CONTRACT_FILE_MAX_MB} MB`)
  const row = await prisma.partnerContractFile.create({
    data: { contractId, publicId: f.publicId, resourceType: f.resourceType, format: f.format?.slice(0, 20) || null, bytes: f.bytes ?? null, originalName: f.originalName?.slice(0, 180) || null, uploadedById: userId },
  })
  await audit(userId, 'UPLOAD', 'PartnerContractFile', row.id, { contractId, originalName: row.originalName })
  return { ok: true, value: { id: row.id } }
}

/** A 2-minute signed link to open a contract file; every opening is written to the audit log. */
export async function contractFileLink(userId: string, fileId: string): Promise<Outcome<{ url: string }>> {
  const f = await prisma.partnerContractFile.findUnique({ where: { id: fileId } })
  if (!f) return fail('NOT_FOUND', 'File not found')
  const url = cloudinary.utils.private_download_url(f.publicId, f.format ?? '', {
    resource_type: f.resourceType as 'image' | 'raw',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 120,
  })
  await audit(userId, 'DOWNLOAD', 'PartnerContractFile', fileId, { contractId: f.contractId, originalName: f.originalName })
  return { ok: true, value: { url } }
}

async function destroyFile(publicId: string, resourceType: string) {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated', invalidate: true })
  } catch (err) {
    console.error('[PARTNER_FILE_DESTROY]', err)
  }
}

export async function deleteContractFile(userId: string, fileId: string): Promise<Outcome> {
  const f = await prisma.partnerContractFile.findUnique({ where: { id: fileId } })
  if (!f) return fail('NOT_FOUND', 'File not found')
  await prisma.partnerContractFile.delete({ where: { id: fileId } })
  await destroyFile(f.publicId, f.resourceType)
  await audit(userId, 'DELETE', 'PartnerContractFile', fileId, { contractId: f.contractId, originalName: f.originalName })
  return { ok: true, value: null }
}

// ───────────────────────── daily alert ─────────────────────────

/** People who may see partners: by role, plus anyone given it personally. */
async function partnerWatchers(): Promise<string[]> {
  const [byRole, personal] = await Promise.all([
    usersWithPermission('partners', 'read'),
    prisma.userPermissionOverride.findMany({ where: { resource: 'partners', action: 'read', allowed: true, user: { isActive: true } }, select: { userId: true } }),
  ])
  const denied = new Set((await prisma.userPermissionOverride.findMany({ where: { resource: 'partners', action: 'read', allowed: false }, select: { userId: true } })).map((x) => x.userId))
  return [...new Set([...byRole, ...personal.map((p) => p.userId)])].filter((id) => !denied.has(id))
}

/** Daily: tells the people with partner access when a contract enters its alert window, and when it ends (each once). */
export async function partnerContractAlerts(now = new Date()) {
  const rows = await prisma.partnerContract.findMany({
    where: { endDate: { not: null }, OR: [{ alertSentAt: null }, { endedNoticeAt: null }], partner: { isActive: true } },
    include: { partner: { select: { name: true } } },
  })
  let before = 0
  let ended = 0
  let watchers: string[] | null = null
  for (const c of rows) {
    const due = contractAlertDue(c, now)
    if (!due) continue
    watchers ??= await partnerWatchers()
    const left = daysLeft(c.endDate, now) ?? 0
    const title = due === 'ENDED' ? `Contract ended: ${c.partner.name}` : `Contract ends in ${left} day${left === 1 ? '' : 's'}: ${c.partner.name}`
    const titleAr = due === 'ENDED' ? `العقد خلص: ${c.partner.name}` : `العقد بيخلص بعد ${left} يوم: ${c.partner.name}`
    await notifyUsers(watchers, 'PARTNER_CONTRACT_ENDING', { title, titleAr, message: `${c.title} — ${c.endDate!.toISOString().slice(0, 10)}. Renew it or record the new contract on the partner page.`, messageAr: `${c.title} — ${c.endDate!.toISOString().slice(0, 10)}. جدّده أو سجّل العقد الجديد في صفحة الشريك.`, relatedId: c.partnerId })
    await prisma.partnerContract.update({ where: { id: c.id }, data: due === 'ENDED' ? { endedNoticeAt: now, ...(c.alertSentAt ? {} : { alertSentAt: now }) } : { alertSentAt: now } })
    if (due === 'ENDED') ended++
    else before++
  }
  return { before, ended }
}
