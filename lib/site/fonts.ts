/** x01: the website's fonts (self-hosted by next/font; shared by every website page). */

import { IBM_Plex_Sans_Arabic, Space_Grotesk } from 'next/font/google'

const ar = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '600', '700'], variable: '--font-tn-ar', display: 'swap' })
const en = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-tn-en', display: 'swap' })

export const siteFontClass = `${ar.variable} ${en.variable}`
