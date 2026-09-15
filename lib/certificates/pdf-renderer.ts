import jsPDF from 'jspdf'

export interface PrintFieldLayout {
  key: 'studentName' | 'courseName' | 'levelName' | 'issueDate' | 'certificateId' | 'qrCode'
  x: number
  y: number
  fontSizePx: number
  fontFamily: string
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
}

export interface PrintCertificate {
  id: string
  certificateNumber: string
  title: string
  issuedDate: string
  qrCodeUrl: string | null
  studentName: string
  courseName: string
  template: {
    backgroundUrl: string
    fieldLayout: PrintFieldLayout[]
    widthPx: number
    heightPx: number
  } | null
}

/** Loads an image URL into a data URL so jsPDF can embed it. */
async function toDataUrl(url: string): Promise<string | null> {
  try {
    if (url.startsWith('data:')) return url
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

function fieldValue(cert: PrintCertificate, key: PrintFieldLayout['key']): string {
  switch (key) {
    case 'studentName': return cert.studentName
    case 'courseName': return cert.courseName
    case 'levelName': return cert.courseName
    case 'issueDate': return new Date(cert.issuedDate).toLocaleDateString('en-EG', { day: 'numeric', month: 'long', year: 'numeric' })
    case 'certificateId': return cert.certificateNumber
    default: return ''
  }
}

/**
 * Renders certificates into a single jsPDF document (one certificate per page,
 * A4 landscape). Returns null when no certificate has a template — without a
 * design there is nothing to draw.
 */
export async function buildCertificatesPdf(certificates: PrintCertificate[]): Promise<jsPDF | null> {
  const withTemplate = certificates.filter((c) => c.template)
  if (withTemplate.length === 0) return null

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < withTemplate.length; i++) {
    const cert = withTemplate[i]
    if (i > 0) pdf.addPage()

    const bg = await toDataUrl(cert.template!.backgroundUrl)
    if (bg) {
      pdf.addImage(bg, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST')
    }

    for (const field of cert.template!.fieldLayout) {
      const xMm = (field.x / 100) * pageW
      const yMm = (field.y / 100) * pageH

      if (field.key === 'qrCode') {
        if (cert.qrCodeUrl) {
          // Field font size doubles as the QR box size, converted px → mm.
          const sizeMm = Math.max(10, field.fontSizePx * 0.26)
          pdf.addImage(cert.qrCodeUrl, 'PNG', xMm - sizeMm / 2, yMm - sizeMm / 2, sizeMm, sizeMm)
        }
        continue
      }

      const text = fieldValue(cert, field.key)
      if (!text) continue

      const [r, g, b] = hexToRgb(field.color)
      pdf.setTextColor(r, g, b)
      // jsPDF sizes text in points; the designer stores px at ~96dpi.
      pdf.setFontSize(field.fontSizePx * 0.75)
      pdf.setFont('helvetica', field.bold ? 'bold' : 'normal')
      pdf.text(text, xMm, yMm, { align: field.align, baseline: 'middle' })
    }
  }

  return pdf
}

/** Groups certificates by course name — used for one-PDF-per-group export. */
export function groupByCourse(certificates: PrintCertificate[]): Map<string, PrintCertificate[]> {
  const groups = new Map<string, PrintCertificate[]>()
  for (const c of certificates) {
    const key = c.courseName || 'Uncategorized'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  return groups
}

export function safeFilename(input: string): string {
  return input.replace(/[^\w\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '_').slice(0, 80)
}
