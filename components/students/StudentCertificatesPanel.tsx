'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { Award, ShieldCheck, ShieldX, EyeOff, Eye, Loader2 } from 'lucide-react'
import { L } from '@/lib/i18n/client'

interface CertificateRow {
  id: string
  title: string
  certificateNumber: string
  issuedDate: string
  status: 'VALID' | 'REVOKED'
  isRevealed: boolean
  subjectId: string | null
}

export function StudentCertificatesPanel({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient()
  const { data: certificates, isLoading } = useQuery<CertificateRow[]>({
    queryKey: ['student-certificates', studentId],
    queryFn: () => fetchApi(`/api/documents?studentId=${studentId}`),
  })

  const toggleReveal = useMutation({
    mutationFn: ({ id, isRevealed }: { id: string; isRevealed: boolean }) =>
      fetchApi(`/api/certificates/${id}/reveal`, { method: 'PATCH', body: JSON.stringify({ isRevealed }) }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['student-certificates', studentId] })
      notify.success(vars.isRevealed ? 'Certificate revealed' : 'Certificate hidden again')
    },
    onError: () => notify.error(L('Failed to update certificate visibility', 'تحديث الشهادة فشل')),
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-600" />
          {L('Certificates', 'الشهادات')}
        </CardTitle>
        <CardDescription className="text-xs">
          {L('Every certificate issued to this student, including ones still awaiting the reveal ceremony.', 'كل شهادات الطالب، ومنها اللي لسه مستنية الحفلة.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
        ) : !certificates || certificates.length === 0 ? (
          <p className="text-xs text-gray-500">{L('No certificates issued yet.', 'لسه مفيش شهادات.')}</p>
        ) : (
          certificates.map((c) => (
            <div key={c.id} className="p-3 rounded-lg border bg-gray-50/80 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.title}</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{c.certificateNumber}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {c.status === 'REVOKED' ? (
                  <Badge variant="outline" className="text-red-600 border-red-200 gap-1 text-[10px]"><ShieldX className="w-3 h-3" /> {L('Revoked', 'اتلغت')}</Badge>
                ) : !c.isRevealed ? (
                  <Badge variant="outline" className="text-amber-600 border-amber-200 gap-1 text-[10px]"><EyeOff className="w-3 h-3" /> {L('Hidden', 'مخفية')}</Badge>
                ) : (
                  <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1 text-[10px]"><ShieldCheck className="w-3 h-3" /> {L('Revealed', 'ظاهرة')}</Badge>
                )}
                {c.status === 'VALID' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px]"
                    disabled={toggleReveal.isPending}
                    onClick={() => toggleReveal.mutate({ id: c.id, isRevealed: !c.isRevealed })}
                  >
                    {c.isRevealed ? <><EyeOff className="w-3 h-3" /> {L('Hide', 'اخفي')}</> : <><Eye className="w-3 h-3" /> {L('Reveal', 'أظهر')}</>}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
