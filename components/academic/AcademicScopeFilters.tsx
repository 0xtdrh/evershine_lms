'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { UseAcademicHierarchyReturn } from '@/hooks/useAcademicHierarchy'

export interface AcademicScopeFiltersProps {
  hierarchy: UseAcademicHierarchyReturn
  /** Show campus + batch selectors (admin workflows) */
  showCampusBatch?: boolean
  /** Show morning/evening session */
  showShift?: boolean
  /** Show class dropdown */
  showClass?: boolean
  className?: string
  compact?: boolean
  onScopeChange?: () => void
  /** When false (e.g. teacher portal), class dropdown does not require full admin scope */
  requireCampusForClass?: boolean
}

/**
 * Branch → Class (Batch and Session were switched off for TechNova, 2026-10-03).
 */
export function AcademicScopeFilters({
  hierarchy,
  showCampusBatch = true,
  showShift = true,
  showClass = true,
  className = '',
  compact = false,
  onScopeChange,
  requireCampusForClass = true,
}: AcademicScopeFiltersProps) {
  const {
    campuses,
    batches,
    filteredClasses,
    scope,
    setCampusId,
    setBatchId,
    setShift,
    setClassId,
    isLoadingCampuses,
    isLoadingBatches,
    isLoadingClasses,
    scopeReady,
  } = hierarchy

  const campusOptions = Array.isArray(campuses) ? campuses : []
  const batchOptions = Array.isArray(batches) ? batches : []
  const classOptions = Array.isArray(filteredClasses) ? filteredClasses : []

  const notify = () => onScopeChange?.()

  const classBlocked =
    requireCampusForClass && !scopeReady

  const gridCols = compact
    ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  return (
    <div className={`space-y-3 ${className}`}>
      <div className={`grid ${gridCols} gap-3`}>
        {showCampusBatch && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-600">Branch *</Label>
              <Select
                value={scope.campusId || undefined}
                onValueChange={(v) => {
                  setCampusId(v)
                  notify()
                }}
                disabled={isLoadingCampuses}
              >
                <SelectTrigger className={compact ? 'h-9' : ''}>
                  <SelectValue placeholder={isLoadingCampuses ? 'Loading…' : 'Select campus'} />
                </SelectTrigger>
                <SelectContent>
                  {campusOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </>
        )}

        {/* Session shift is switched off for TechNova (2026-10-03): the chosen class sets it. */}
        {showClass && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-600">Class *</Label>
            <Select
              value={scope.classId || undefined}
              disabled={classBlocked || isLoadingClasses || classOptions.length === 0}
              onValueChange={(v) => {
                setClassId(v)
                notify()
              }}
            >
              <SelectTrigger className={compact ? 'h-9' : ''}>
                <SelectValue
                  placeholder={
                    classBlocked
                      ? 'Select the branch first'
                      : isLoadingClasses
                        ? 'Loading classes…'
                        : classOptions.length === 0
                          ? 'No classes for this scope'
                          : 'Select class'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {classOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.section ? ` (${c.section})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

    </div>
  )
}
