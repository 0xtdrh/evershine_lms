'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'

interface BranchTotal {
  campusId: string
  campusName: string
  expected: number
  collected: number
  outstanding: number
  teacherPay: number
  profit: number
  groupCount: number
}

interface Summary {
  branches: BranchTotal[]
  company: { expected: number; collected: number; outstanding: number; teacherPay: number; profit: number; groupCount: number }
}

export default function GroupsFinancialsSummaryPage() {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ['groups-financials-summary'],
    queryFn: () => fetchApi('/api/reports/groups-financials-summary'),
  })

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Groups Financial Summary</h1>
        <CardDescription>Every branch&apos;s totals, and the company-wide total.</CardDescription>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Groups', value: data.company.groupCount, cls: 'bg-slate-50 text-slate-800' },
              { label: 'Expected', value: data.company.expected, cls: 'bg-slate-50 text-slate-800' },
              { label: 'Collected', value: data.company.collected, cls: 'bg-emerald-50 text-emerald-700' },
              { label: 'Instructor pay', value: data.company.teacherPay, cls: 'bg-slate-50 text-slate-800' },
              { label: 'Profit', value: data.company.profit, cls: 'bg-indigo-50 text-indigo-700' },
            ].map((c) => (
              <div key={c.label} className={`rounded-xl p-3 text-center ${c.cls}`}>
                <p className="text-xs opacity-70">{c.label}</p>
                <p className="text-lg font-bold">{c.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-center">Groups</TableHead>
                <TableHead className="text-center">Expected</TableHead>
                <TableHead className="text-center">Collected</TableHead>
                <TableHead className="text-center">Outstanding</TableHead>
                <TableHead className="text-center">Instructor pay</TableHead>
                <TableHead className="text-center">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.branches.map((b) => (
                <TableRow key={b.campusId}>
                  <TableCell className="font-medium text-slate-800">{b.campusName}</TableCell>
                  <TableCell className="text-center">{b.groupCount}</TableCell>
                  <TableCell className="text-center">{b.expected.toLocaleString()}</TableCell>
                  <TableCell className="text-center">{b.collected.toLocaleString()}</TableCell>
                  <TableCell className="text-center">{b.outstanding.toLocaleString()}</TableCell>
                  <TableCell className="text-center">{b.teacherPay.toLocaleString()}</TableCell>
                  <TableCell className="text-center font-medium text-indigo-700">{b.profit.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </div>
  )
}
