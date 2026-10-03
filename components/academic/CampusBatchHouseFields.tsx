'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { performanceHouseRequired } from '@/lib/academic/hierarchy'
import type { AcademicBatch, AcademicCampus, AcademicHouse } from '@/lib/academic/types'

export interface CampusBatchHouseFieldsProps {
  campusId: string
  batchId: string
  houseId: string
  campuses: AcademicCampus[]
  batches: AcademicBatch[]
  houses: AcademicHouse[]
  onCampusChange: (campusId: string) => void
  onBatchChange: (batchId: string) => void
  onHouseChange: (houseId: string) => void
  isLoadingBatches?: boolean
  isLoadingHouses?: boolean
  campusError?: string
  batchError?: string
  houseError?: string
  /** Hide campus when already fixed (e.g. single-campus admin) */
  showCampus?: boolean
  className?: string
}

/**
 * Campus field for forms (teachers). Batch / Performance House were removed (switched off for TechNova);
 * the props stay so the callers compile unchanged.
 * Matches AcademicScopeFilters rules: batch required; house required when batch has houses.
 */
export function CampusBatchHouseFields({
  campusId,
  batchId,
  houseId,
  campuses,
  batches,
  houses,
  onCampusChange,
  onBatchChange,
  onHouseChange,
  isLoadingBatches = false,
  isLoadingHouses = false,
  campusError,
  batchError,
  houseError,
  showCampus = true,
  className = '',
}: CampusBatchHouseFieldsProps) {
  const hasHouses = houses.length > 0
  const houseRequired = performanceHouseRequired(hasHouses)

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${className}`}>
      {showCampus && (
        <div className="space-y-1.5">
          <Label>Campus *</Label>
          <Select value={campusId || undefined} onValueChange={onCampusChange}>
            <SelectTrigger className={campusError ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select campus" />
            </SelectTrigger>
            <SelectContent>
              {campuses.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {campusError && <p className="text-xs text-destructive">{campusError}</p>}
        </div>
      )}

      {/* Batch and Performance House are switched off for TechNova (2026-10-03): the server uses the branch's default batch. */}
    </div>
  )
}
