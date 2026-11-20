import { describe, expect, it } from 'vitest'
import { tasksFor } from '@/lib/today/catalog'

describe('today tasks need read on the part they open (final test J04)', () => {
  const keys = (can: (r: string, a: string) => boolean) => tasksFor('SECRETARY', can as never).map((t) => t.key)

  it('a secretary with renewals update but NOT read does not get the renewals task', () => {
    const k = keys((r, a) => !(r === 'renewals' && a === 'read'))
    expect(k).not.toContain('renewalsUnanswered')
  })

  it('with read and update the task is there', () => {
    expect(keys(() => true)).toContain('renewalsUnanswered')
  })
})
