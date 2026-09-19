'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Loader2, TrendingUp, AlertTriangle, CalendarCheck, Users } from 'lucide-react'

interface Campus { id: string; name: string; code: string }

interface GroupRow {
  classSectionId: string
  label: string
  campusName: string
  totalStudents: number
  totalMarked: number
  present: number
  absent: number
  late: number
  excused: number
  attendanceRate: number | null
}

interface AtRiskStudent {
  studentId: string
  studentEnrollmentId: string
  name: string
  registrationNumber: string
  classSection: string
  campusName: string
  totalMarkedDays: number
  present: number
  absent: number
  late: number
  excused: number
  attendanceRate: number | null
  consecutiveUnexcusedAbsences: number
  atRisk: boolean
}

interface AttendanceReport {
  academicYear: { id: string; name: string } | null
  consecutiveAbsenceThreshold: number
  overallRate: number | null
  totalRecordsMarked: number
  groups: GroupRow[]
  atRiskStudents: AtRiskStudent[]
  students: AtRiskStudent[]
}

function rateBadge(rate: number | null) {
  if (rate === null) return <Badge variant="outline" className="text-slate-400">No data</Badge>
  if (rate >= 90) return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">{rate}%</Badge>
  if (rate >= 75) return <Badge className="bg-amber-50 text-amber-700 border-amber-100">{rate}%</Badge>
  return <Badge className="bg-rose-50 text-rose-700 border-rose-100">{rate}%</Badge>
}

export default function AttendanceReportPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as string | undefined
  const [campusId, setCampusId] = useState<string>('all')

  const { data: campuses = [] } = useQuery<Campus[]>({
    queryKey: ['campuses-for-attendance-report'],
    queryFn: () => fetchApi('/api/campuses'),
    enabled: role === 'SUPER_ADMIN',
  })

  const { data: report, isLoading } = useQuery<AttendanceReport>({
    queryKey: ['attendance-report', campusId],
    queryFn: () =>
      fetchApi(`/api/admin/reports/attendance${campusId !== 'all' ? `?campusId=${campusId}` : ''}`),
  })

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Attendance Report</h1>
          <CardDescription>
            {report?.academicYear ? `Academic year ${report.academicYear.name}` : 'No active academic year'}
          </CardDescription>
        </div>
        {role === 'SUPER_ADMIN' && (
          <Select value={campusId} onValueChange={setCampusId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All campuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campuses</SelectItem>
              {campuses.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : !report ? (
        <p className="text-sm text-slate-400 text-center py-16">Could not load the attendance report.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {report.overallRate === null ? '—' : `${report.overallRate}%`}
                  </p>
                  <p className="text-xs text-slate-500">Overall attendance rate</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <CalendarCheck className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{report.totalRecordsMarked}</p>
                  <p className="text-xs text-slate-500">Attendance days marked</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{report.atRiskStudents.length}</p>
                  <p className="text-xs text-slate-500">
                    At risk ({report.consecutiveAbsenceThreshold}+ consecutive unexcused absences)
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                Students at risk
              </CardTitle>
              <CardDescription>
                {report.consecutiveAbsenceThreshold} or more consecutive unexcused absences, most recent first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.atRiskStudents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No students currently at risk.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-center">Consecutive absences</TableHead>
                      <TableHead className="text-center">Overall rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.atRiskStudents.map((s) => (
                      <TableRow key={s.studentEnrollmentId}>
                        <TableCell>
                          <p className="font-medium text-slate-800">{s.name}</p>
                          <p className="text-xs text-slate-400">{s.registrationNumber}</p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {s.classSection}
                          <span className="text-slate-400"> · {s.campusName}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className="bg-rose-50 text-rose-700 border-rose-100">
                            {s.consecutiveUnexcusedAbsences} days
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{rateBadge(s.attendanceRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-600" />
                By group
              </CardTitle>
              <CardDescription>Attendance rate per class section, active academic year.</CardDescription>
            </CardHeader>
            <CardContent>
              {report.groups.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No attendance has been marked yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-center">Students</TableHead>
                      <TableHead className="text-center">Present</TableHead>
                      <TableHead className="text-center">Absent</TableHead>
                      <TableHead className="text-center">Late</TableHead>
                      <TableHead className="text-center">Excused</TableHead>
                      <TableHead className="text-center">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.groups.map((g) => (
                      <TableRow key={g.classSectionId}>
                        <TableCell>
                          <p className="font-medium text-slate-800">{g.label}</p>
                          <p className="text-xs text-slate-400">{g.campusName}</p>
                        </TableCell>
                        <TableCell className="text-center">{g.totalStudents}</TableCell>
                        <TableCell className="text-center">{g.present}</TableCell>
                        <TableCell className="text-center">{g.absent}</TableCell>
                        <TableCell className="text-center">{g.late}</TableCell>
                        <TableCell className="text-center">{g.excused}</TableCell>
                        <TableCell className="text-center">{rateBadge(g.attendanceRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
