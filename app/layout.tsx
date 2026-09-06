import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import { SessionProvider } from "next-auth/react";
import { PWARegister } from "@/components/providers/PWARegister";

export const viewport: Viewport = {
  themeColor: "#0F4C81",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "TechNova Management | STEM, Robotics & Programming Academy",
    template: "%s | TechNova Management",
  },
  description: "TechNova Management is the integrated platform for TechNova's branches, courses, students, and instructors across STEM education, programming, robotics, and smart technology.",
  keywords: [
    "TechNova",
    "TechNova Management",
    "TechNova Academy",
    "STEM Education",
    "Robotics Training",
    "Programming Courses",
    "Learning Management System",
    "Academy Management System",
    "Student Portal",
    "Teacher Portal",
    "Online Classes",
    "Hurghada Academy",
    "Egypt STEM",
    "Digital Learning",
    "Online Courses",
  ],
  authors: [{ name: "TechNova" }],
  creator: "TechNova",
  publisher: "TechNova",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://evershine-lms-technova.vercel.app/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://evershine-lms-technova.vercel.app/",
    siteName: "TechNova Management",
    title: "TechNova Management | STEM, Robotics & Programming Academy",
    description: "The integrated platform for TechNova's branches, courses, students, and instructors across STEM education, programming, robotics, and smart technology.",
    images: [
      {
        url: "/brand/pwa-icon-512.png",
        width: 512,
        height: 512,
        alt: "TechNova Management",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TechNova Management | STEM, Robotics & Programming Academy",
    description: "The integrated platform for TechNova's branches, courses, students, and instructors across STEM education, programming, robotics, and smart technology.",
    images: ["/brand/pwa-icon-512.png"],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TechNova Management",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-128x128.png", sizes: "128x128", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: "/brand/pwa-icon-180.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": "TechNova Management",
    "msapplication-TileColor": "#0f172a",
    "msapplication-TileImage": "/brand/pwa-icon-192.png",
  },
};


// Hostinger replaces the active standalone bundle during each deployment.
// Static HTML cached by an edge for a previous build can therefore reference
// chunk hashes that no longer exist in the new bundle. Rendering document
// routes dynamically makes Next.js emit private/no-store cache headers while
// keeping content-hashed /_next/static assets immutable and cacheable.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("h-full")} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "EducationalOrganization",
              "@id": "https://evershine-lms-technova.vercel.app/#organization",
              "name": "TechNova",
              "url": "https://evershine-lms-technova.vercel.app/",
              "logo": {
                "@type": "ImageObject",
                "url": "https://evershine-lms-technova.vercel.app/brand/bglogo.png"
              },
              "description": "TechNova is a technology company specializing in STEM education, programming, robotics, and smart technology solutions, with branches across Hurghada, Al-Qusair, and Safaga.",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Hurghada",
                "addressRegion": "Red Sea",
                "addressCountry": "EG"
              },
              "telephone": "+20-123-3344758"
            })
          }}
        />
      </head>
      <body
        className="min-h-full bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        <SessionProvider>
          <Providers>
            {children}
            <PWARegister />
            <Toaster />
          </Providers>
        </SessionProvider>
      </body>
    </html>
  );
}

