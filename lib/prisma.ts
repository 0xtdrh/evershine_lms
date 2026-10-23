import { PrismaClient } from '@prisma/client'
import { withAutoAudit } from './audit/auto'
import { currentActorId, runWithActor } from './audit/actor'
import { withPoolLimits } from './db-url'

// WHY singleton: Next.js hot reload creates new module instances on each change.
// Without this, development exhausts the MySQL connection pool.
//
// WHY lazy Proxy: `next build` imports every server module to collect page/route
// metadata. Throwing at module-load time (when DATABASE_URL is absent in the CI
// build environment) kills the build before a single page is rendered.
// The Proxy defers PrismaClient construction — and therefore DATABASE_URL
// validation — until the first actual DB call at *runtime*, not build time.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL

  if (!url) {
    console.error(
      '[PRISMA] DATABASE_URL is not set.\n' +
      '  If running locally: copy .env.example to .env and fill in your credentials.\n' +
      '  If running on Hostinger: set DATABASE_URL in hPanel → Node.js → Environment Variables.\n' +
      '  Expected format: mysql://user:password@host:3306/database'
    )
    throw new Error('DATABASE_URL is not set. Cannot initialize Prisma.')
  }

  if (!url.startsWith('mysql://')) {
    console.error(
      `[PRISMA] DATABASE_URL must start with mysql:// — got: ${url.substring(0, 30)}...\n` +
      '  Fix the URL in your .env file or in hPanel environment variables.'
    )
    throw new Error('DATABASE_URL must start with mysql://')
  }

  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    // small pool per instance (Aiven free has few connections) — see lib/db-url.ts
    datasources: { db: { url: withPoolLimits(url, process.env) } },
  })
  // 2026-10-18: changes on the important tables are logged automatically (who, old value → new value)
  const audited = withAutoAudit(base, currentActorId)
  // keep "who is acting" inside interactive transactions (Prisma runs the callback outside the request context).
  // Done on the client itself, because modules loaded later read globalThis.prisma directly (not the lazy proxy).
  return new Proxy(audited, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value
      if (prop !== '$transaction') return value.bind(target)
      const tx = value.bind(target)
      return (arg: unknown, opts?: unknown) => {
        if (typeof arg !== 'function') return tx(arg, opts)
        const actor = currentActorId()
        return tx((t: unknown) => runWithActor(actor, () => (arg as (x: unknown) => unknown)(t)), opts)
      }
    },
  })
}

// WHY Proxy: Allows this module to be safely imported at build time without
// a live DATABASE_URL. The real PrismaClient is only instantiated on the first
// property access (i.e. the first actual database call at runtime).
//
// WHY always write globalForPrisma.prisma (not just in dev):
// In development, this prevents hot-reload from creating N clients as modules
// are re-evaluated. In production, Next.js standalone can re-evaluate modules
// across Worker threads or dynamic import() boundaries. Unconditional caching
// in globalThis guarantees exactly ONE PrismaClient per Node.js process,
// preventing MySQL connection pool exhaustion under concurrent load.
function makeLazyPrisma(): PrismaClient {
  let client: PrismaClient | null = null

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (!client) {
        client = globalForPrisma.prisma ?? createPrismaClient()
        // WHY unconditional: see module-level comment above.
        globalForPrisma.prisma = client
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (client as any)[prop]
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? makeLazyPrisma()
