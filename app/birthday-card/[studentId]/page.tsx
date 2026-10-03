'use client'

/** Phase C: printable birthday certificate for parents, students and staff (same design as Documents). */

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { BirthdayCertificate } from '@/components/documents/BirthdayCertificate'
import { ArrowLeft, Printer } from 'lucide-react'

interface Card { firstName: string; lastName: string; dateOfBirth: string; registrationNumber: string; photoUrl: string | null; group: string }

export default function BirthdayCardPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  const { data, error, isLoading } = useQuery({ queryKey: ['birthday-card', studentId], queryFn: () => fetchApi<Card>(`/api/students/${studentId}/birthday-card`), retry: false })
  if (error) return <div className="p-6 text-sm"><p className="mb-2 text-red-600">{(error as Error).message}</p><Link href="/login" className="text-blue-600 underline">Sign in</Link></div>
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 0; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-xl flex-wrap justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print / save as PDF</Button>
      </div>
      {isLoading || !data ? <p className="text-center text-sm text-gray-500">Loading…</p> : (
        <div className="flex justify-center overflow-x-auto px-2">
          <BirthdayCertificate
            firstName={data.firstName}
            lastName={data.lastName}
            dateOfBirth={data.dateOfBirth}
            photoSrc={data.photoUrl}
            groupLabel={data.group}
            registrationNumber={data.registrationNumber}
          />
        </div>
      )}
    </div>
  )
}
