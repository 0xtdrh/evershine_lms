import { redirect } from 'next/navigation'

// Batches and houses are switched off for TechNova (2026-10-03, owner's request):
// the system uses one default batch per branch in the background
// (lib/batches/default-batch.ts). The old management screens are gone; the
// data stays in the database untouched. Old links land on Groups.
export default function BatchesSwitchedOff() {
  redirect('/dashboard/groups')
}
