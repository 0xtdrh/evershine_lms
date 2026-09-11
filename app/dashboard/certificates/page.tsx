'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Award, PartyPopper, ShieldCheck } from 'lucide-react'

interface FieldLayoutItem {
  key: 'studentName' | 'courseName' | 'levelName' | 'issueDate' | 'certificateId' | 'qrCode'
  x: number
  y: number
  fontSizePx: number
  fontFamily: string
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
}

interface MyCertificate {
  id: string
  title: string
  certificateNumber: string
  issuedDate: string
  isRevealed: boolean
  qrCodeUrl: string | null
  subject: { name: string } | null
  template: { backgroundUrl: string; fieldLayout: FieldLayoutItem[]; widthPx: number; heightPx: number } | null
}

interface Child { id: string; firstName: string; lastName: string }

function CertificateCard({ cert, studentName }: { cert: MyCertificate; studentName: string }) {
  const fieldValue = (key: FieldLayoutItem['key']) => {
    switch (key) {
      case 'studentName': return studentName
      case 'courseName': return cert.subject?.name ?? ''
      case 'levelName': return cert.subject?.name ?? ''
      case 'issueDate': return new Date(cert.issuedDate).toLocaleDateString('en-EG', { day: 'numeric', month: 'long', year: 'numeric' })
      case 'certificateId': return cert.certificateNumber
      default: return ''
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-[1.414/1] bg-slate-100">
        {cert.template ? (
          <div className={`absolute inset-0 transition-all ${!cert.isRevealed ? 'blur-xl scale-105' : ''}`}>
            <img src={cert.template.backgroundUrl} alt={cert.title} className="w-full h-full object-cover" />
            {cert.template.fieldLayout.filter((f) => f.key !== 'qrCode').map((f) => (
              <span
                key={f.key}
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
                style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: `${f.fontSizePx / 3}px`, color: f.color, fontFamily: f.fontFamily, fontWeight: f.bold ? 700 : 400, textAlign: f.align }}
              >
                {fieldValue(f.key)}
              </span>
            ))}
            {cert.qrCodeUrl && cert.template.fieldLayout.find((f) => f.key === 'qrCode') && (
              <img
                src={cert.qrCodeUrl}
                alt="QR"
                className="absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16"
                style={{
                  left: `${cert.template.fieldLayout.find((f) => f.key === 'qrCode')!.x}%`,
                  top: `${cert.template.fieldLayout.find((f) => f.key === 'qrCode')!.y}%`,
                }}
              />
            )}
          </div>
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-50 ${!cert.isRevealed ? 'blur-lg' : ''}`}>
            <Award className="w-16 h-16 text-indigo-300" />
          </div>
        )}

        {!cert.isRevealed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10 text-center px-4">
            <PartyPopper className="w-8 h-8 text-white drop-shadow mb-2" />
            <p className="text-white font-bold drop-shadow">Certificate Earned! 🎉</p>
            <p className="text-white/90 text-xs mt-1 drop-shadow max-w-[220px]">
              This will be revealed at the upcoming TechNova ceremony.
            </p>
          </div>
        )}
      </div>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-slate-900 text-sm">{cert.title}</p>
          {cert.isRevealed && (
            <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1 text-[10px]"><ShieldCheck className="w-3 h-3" /> Verified</Badge>
          )}
        </div>
        <p className="text-xs text-slate-400 font-mono">{cert.certificateNumber}</p>
      </CardContent>
    </Card>
  )
}

export default function MyCertificatesPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const [selectedChildId, setSelectedChildId] = useState('')

  const { data: children = [] } = useQuery<Child[]>({
    queryKey: ['guardian-children'],
    queryFn: () => fetchApi('/api/guardian-portal/children'),
    enabled: role === 'GUARDIAN' || role === 'PARENT',
  })

  const activeChildId = selectedChildId || children[0]?.id || ''
  const isGuardian = role === 'GUARDIAN' || role === 'PARENT'

  const { data: certificates = [], isLoading } = useQuery<MyCertificate[]>({
    queryKey: ['my-certificates', isGuardian ? activeChildId : 'self'],
    queryFn: () => fetchApi(isGuardian ? `/api/certificates/mine?studentId=${activeChildId}` : '/api/certificates/mine'),
    enabled: isGuardian ? !!activeChildId : true,
  })

  const activeChild = children.find((c) => c.id === activeChildId)
  const studentName = isGuardian
    ? (activeChild ? `${activeChild.firstName} ${activeChild.lastName}` : '')
    : (session?.user?.name ?? '')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Award className="w-6 h-6 text-indigo-600" /> Certificates
          </h1>
          <p className="text-sm text-slate-500 mt-1">Every certificate earned at TechNova, with a QR code you can use to verify it anytime.</p>
        </div>
        {isGuardian && children.length > 1 && (
          <Select value={activeChildId} onValueChange={setSelectedChildId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select child" /></SelectTrigger>
            <SelectContent>
              {children.map((c) => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : certificates.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-slate-400">No certificates yet — keep learning!</CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {certificates.map((c) => <CertificateCard key={c.id} cert={c} studentName={studentName} />)}
        </div>
      )}
    </div>
  )
}
