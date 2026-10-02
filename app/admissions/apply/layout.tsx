import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apply Online',
  description: 'Apply online for admission to TechNova. Fill out the application form with personal details, contact information, and upload a personal photo.',
  alternates: {
    canonical: 'https://evershine-lms-technova.vercel.app/admissions/apply',
  },
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
