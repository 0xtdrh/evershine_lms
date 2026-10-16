'use client'

/**
 * Reports centre (5-C, 2026-10-17): every TechNova report and export, one card each, grouped, with search.
 * The list lives in lib/reports/registry.ts; only the reports the person may open are shown (4-level permissions).
 */

import { CardCentre } from '@/components/centers/CardCentre'
import { REPORT_CARDS, REPORT_GROUPS } from '@/lib/reports/registry'
import { LineChart } from 'lucide-react'

export default function ReportsCenterPage() {
  return (
    <CardCentre icon={LineChart} title={['Reports centre', 'مركز التقارير']} subtitle={['Every TechNova report and export in one place.', 'كل تقارير TechNova والتصدير في مكان واحد.']}
      searchHint={['Find a report…', 'دوّر على تقرير…']} groups={REPORT_GROUPS} cards={REPORT_CARDS} />
  )
}
