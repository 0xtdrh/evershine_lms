'use client'

/**
 * a02 M1: the tracks and courses offered in one place (Course Structure → "where offered"), for pickers that make a
 * group / an admission there. No place = the whole catalog. NO_TRACK = the picker value for standalone courses.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'

export const NO_TRACK = '__none__'

export interface OfferedTrack { id: string; name: string }
export interface OfferedCourse { id: string; name: string; code?: string; track: { id: string; name: string } | null }

export function useOffered(campusId: string | null | undefined) {
  const q = campusId ? `?campusId=${campusId}` : ''
  const { data: tracks = [] } = useQuery<OfferedTrack[]>({ queryKey: ['tracks', 'offered', campusId ?? ''], queryFn: () => fetchApi(`/api/tracks${q}`) })
  const { data: courses = [] } = useQuery<OfferedCourse[]>({ queryKey: ['academic-subjects', 'offered', campusId ?? ''], queryFn: () => fetchApi(`/api/academic-subjects${q}`) })
  return { tracks, courses }
}
