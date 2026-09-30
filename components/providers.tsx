'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import queryClient from '@/lib/query-client'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Dark mode: adds class="dark" on <html> (see app/dark-theme.generated.css).
    // Light by default; the choice is remembered per browser.
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}
