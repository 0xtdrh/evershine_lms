/** GET /api/guardian-portal/family/courses?person=m:<memberId>|s:<studentId> — six phases 1-A: the courses that suit one person. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { coursesFor, familyOf } from '@/lib/accounts/engine'
import { familySession } from '@/lib/accounts/portal'
import { FIT_TEXT, canBook } from '@/lib/accounts/rules'

export async function GET(request: NextRequest) {
  const f = await familySession()
  if (f.error) return f.error
  const key = request.nextUrl.searchParams.get('person') ?? ''
  const person = (await familyOf(f.guardian.id)).find((p) => p.key === key)
  if (!person) return errors.notFound('Person')
  const { settings, courses } = await coursesFor(f.guardian.id, person)
  return successResponse({
    person: { key: person.key, firstName: person.firstName, age: person.age },
    unsuitable: settings.unsuitable,
    courses: courses.map((c) => ({
      slug: c.slug, refType: c.refType, title: c.title, summary: c.summary, imageUrl: c.imageUrl, color: c.color, minAge: c.minAge, maxAge: c.maxAge,
      trackName: c.trackName, levels: c.levels.length, modes: c.modes, price: c.price, fit: c.fit, fitText: FIT_TEXT[c.fit], bookable: canBook(c.fit),
    })),
  })
}
