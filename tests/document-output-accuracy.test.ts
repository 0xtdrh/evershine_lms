import { describe, expect, it } from 'vitest'
import {
  accountRows,
  parsePaymentDetails,
  paymentDetailsRowsFromSnapshot,
} from '@/lib/fees/payment-details'
import {
  getCanonicalStudentClassSection,
  getCanonicalStudentRollNumber,
} from '@/lib/academic/record-formatters'
import { generateAdministrationDirectoryCardDirect } from '@/lib/pdf/direct-generators'

describe('canonical document record mapping', () => {
  it('uses active enrollment values before legacy placement fields', () => {
    const student = {
      class: { name: 'Legacy Class' },
      section: 'Z',
      rollNumber: 'legacy-roll',
      activeEnrollments: [{
        status: 'ACTIVE',
        rollNumber: 'A-12',
        classSection: {
          className: 'Class 11',
          sectionName: 'A',
          shift: { name: 'Morning Shift', code: 'MORNING' },
        },
      }],
    }

    expect(getCanonicalStudentClassSection(student)).toBe('Class 11 - A (Morning Shift)')
    expect(getCanonicalStudentRollNumber(student)).toBe('A-12')
  })

  it('builds payment rows from a configured account and parses the snapshot back', () => {
    const rows = accountRows({
      kind: 'INSTAPAY', label: 'InstaPay', accountName: 'TechNova', accountNumber: '01012345678',
      bankName: null, iban: null, instructions: 'Send the screenshot after paying',
    })
    expect(rows).toEqual([
      { label: 'InstaPay', value: '01012345678' },
      { label: 'InstaPay - account name', value: 'TechNova' },
      { label: 'InstaPay - note', value: 'Send the screenshot after paying' },
    ])
    const snapshot = rows.map((r) => `${r.label}: ${r.value}`).join('\n')
    expect(parsePaymentDetails(snapshot)).toEqual(rows)
  })

  it('never falls back to a hard-coded bank account when none is configured', () => {
    expect(paymentDetailsRowsFromSnapshot(null)).toEqual([])
  })

  it('creates a two-page administration directory card', async () => {
    const pdf = await generateAdministrationDirectoryCardDirect({
      name: 'Ali Aslam',
      roleLabel: 'SUPER ADMINISTRATOR',
      email: 'admin@example.com',
      employeeId: 'TN-ADM-001',
      department: 'Finance & Administration',
      campus: 'Madina Town Campus',
      cardSerial: 'adm_demo_123',
      isActive: true,
      colorMode: 'bw',
    })
    expect(pdf.getNumberOfPages()).toBe(2)
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(85.6, 1)
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(54, 1)

    const output = pdf.output()
    expect(output).toContain('PROPERTY OF TECHNOVA')
    expect(output).toContain('TN-ADM-001')
    expect(output).toContain('adm_demo_123')
  })
})
