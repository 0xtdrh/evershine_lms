import { CheckCircle2, XCircle, ShieldCheck, Calendar, GraduationCap, User } from 'lucide-react'
import { AcademyLogo } from '@/components/AcademyLogo'
import Link from 'next/link'

async function getVerification(certificateNumber: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://evershine-lms-technova.vercel.app'
  try {
    const res = await fetch(`${base}/api/verify/${encodeURIComponent(certificateNumber)}`, {
      cache: 'no-store',
    })
    const json = await res.json()
    return { ok: res.ok, ...json }
  } catch {
    return { ok: false, valid: false, error: 'Could not reach the verification service.' }
  }
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ certificateNumber: string }>
}) {
  const { certificateNumber } = await params
  const result = await getVerification(certificateNumber)

  const found = result.ok && result.data
  const isValid = found && result.valid

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      <header className="bg-gradient-to-r from-blue-900 to-blue-700 py-5 px-4 sm:px-8">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <AcademyLogo variant="compact" theme="mono-white" />
          <div className="text-white">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">TechNova</h1>
            <p className="text-xs text-blue-200 uppercase tracking-widest">Certificate Verification</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          {found ? (
            <>
              <div className={`px-6 py-5 flex items-center gap-3 ${isValid ? 'bg-emerald-50 border-b border-emerald-100' : 'bg-red-50 border-b border-red-100'}`}>
                {isValid ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-600 shrink-0" />
                )}
                <div>
                  <p className={`font-bold text-lg ${isValid ? 'text-emerald-800' : 'text-red-800'}`}>
                    {isValid ? 'Certificate Verified' : 'Certificate Revoked'}
                  </p>
                  <p className={`text-xs ${isValid ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isValid ? 'This is a genuine TechNova certificate.' : 'This certificate is no longer valid.'}
                  </p>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Student</p>
                    <p className="font-semibold text-slate-900">{result.data.studentName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <GraduationCap className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Certificate</p>
                    <p className="font-semibold text-slate-900">{result.data.title}</p>
                    {result.data.courseName && (
                      <p className="text-sm text-slate-500">{result.data.courseName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Issued</p>
                    <p className="font-semibold text-slate-900">
                      {new Date(result.data.issuedDate).toLocaleDateString('en-EG', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Certificate ID</p>
                    <p className="font-mono text-sm text-slate-700">{result.data.certificateNumber}</p>
                  </div>
                </div>

                {!isValid && result.data.revokedReason && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700">
                    <strong>Reason:</strong> {result.data.revokedReason}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 text-center space-y-3">
              <XCircle className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="font-bold text-slate-900">Certificate Not Found</p>
              <p className="text-sm text-slate-500">
                No TechNova certificate matches the number <span className="font-mono">{certificateNumber}</span>.
                Double-check the ID or QR code and try again.
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="text-center pb-8">
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">© {new Date().getFullYear()} TechNova · Certificate Verification System</Link>
      </footer>
    </div>
  )
}
