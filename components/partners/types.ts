/** M1 partners — shapes returned by GET /api/partners/[id]. */

export interface PartnerPlace {
  id: string; name: string; code: string; address: string; phone: string; email: string; principalName: string; isActive: boolean
  activeGroups: number; students: number
}
export interface ContractFile { id: string; originalName: string | null; format: string | null; bytes: number | null; createdAt: string }
export interface PartnerContract {
  id: string; title: string; startDate: string; endDate: string | null; alertDaysBefore: number; notes: string | null
  state: string; daysLeft: number | null; files: ContractFile[]
}
export interface PartnerDetail {
  id: string; name: string; kind: string; contactName: string | null; contactPhone: string | null; contactEmail: string | null
  address: string | null; notes: string | null; isActive: boolean
  places: PartnerPlace[]; contracts: PartnerContract[]
}
