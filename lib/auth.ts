/**
 * lib/auth.ts — Full NextAuth.js v5 (Node.js runtime) instantiation
 *
 * WHY NOT edge-compatible: This file imports @node-rs/argon2 (native binary)
 * and @prisma/client (Node.js-only). It must ONLY be imported from:
 *  - API route handlers (app/api/**)
 *  - Server Components (async components with no 'use client')
 *  - Server Actions
 *
 * WHY NO PrismaAdapter:
 *  This system uses Credentials provider + JWT session strategy exclusively.
 *  PrismaAdapter is designed for OAuth providers and database session storage.
 *  It expects prisma.account and prisma.verificationToken models which do not
 *  exist in this schema (Credentials users are managed directly via prisma.user).
 *  Including the adapter with missing schema models causes runtime errors
 *  when NextAuth internally calls adapter methods (getUserByAccount, etc.)
 *  on certain request paths in production. Removing it is both safe and correct
 *  for a Credentials + JWT architecture.
 *
 * Auth flow summary:
 *  1. POST /api/auth/callback/credentials → authorize() → validates email +
 *     Argon2id hash against MySQL via prisma.user.findUnique
 *  2. jwt() callback → embeds id, role, campusId into signed JWT (NEXTAUTH_SECRET)
 *  3. Cookie set: next-auth.session-token (httpOnly, SameSite=lax)
 *  4. Every subsequent request → middleware decodes JWT via authConfig (Edge)
 *  5. session() callback → maps JWT claims to session.user for client components
 */

import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { verify } from '@node-rs/argon2'
import { compare } from 'bcryptjs'
import { loginSchema } from '@/lib/validation/user'
import { authConfig } from '@/lib/auth.config'
import { ensurePermissionOverrides } from '@/lib/rbac-overrides'
import { isDefaultPortalPassword, resolveLoginEmail } from '@/lib/portal-login'
import { accountKey, clearLoginFailures, clientIp, isLoginLocked, recordLoginFailure } from '@/lib/login-throttle'
import { guardSession } from '@/lib/session-guard'

/** Shown on the login page as ?code=default_password */
class DefaultPasswordSignin extends CredentialsSignin {
  code = 'default_password'
}

/** Shown on the login page: too many failed attempts (lib/login-throttle.ts). */
class TooManyAttemptsSignin extends CredentialsSignin {
  code = 'too_many_attempts'
}

export const { handlers, signIn, signOut, auth: nextAuthSession } = NextAuth({
  ...authConfig,

  // WHY no adapter: See module-level comment. Credentials + JWT requires no
  // database adapter. Session data lives entirely in the signed JWT cookie.

  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email or phone', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, request) {
        // ── Input validation ──────────────────────────────────────────────
        // loginSchema: email-or-phone identifier + password (min 6)
        // Rejecting at this layer before any DB touch prevents enumeration
        // attacks via timing differences.
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const { email: identifier, password } = parsed.data
        // Parents can sign in with their phone number (Guardian.phoneNumber is
        // the parent's identity); everyone else uses their email.
        const email = await resolveLoginEmail(identifier)

        // ── Throttle (before any password work) ───────────────────────────
        // Counted per account (resolved email, so every phone format of a
        // parent counts together) and per IP. See lib/login-throttle.ts.
        const key = accountKey(email ?? identifier)
        const ip = clientIp(request as Request | undefined)
        if (await isLoginLocked(key, ip)) throw new TooManyAttemptsSignin()

        if (!email) {
          await recordLoginFailure(key, ip)
          return null
        }

        // ── Identity lookup ───────────────────────────────────────────────
        // WHY select only needed columns: avoids LEFT JOINs on 6 profile
        // tables for every login attempt. isActive is checked first to
        // short-circuit suspended accounts without doing bcrypt/argon work.
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id:           true,
            email:        true,
            passwordHash: true,
            role:         true,
            isActive:     true,
            mustChangePassword: true,
          },
        })

        // Return null (not throw) to signal "invalid credentials" to NextAuth.
        // Throwing would trigger a 500; returning null triggers a 401.
        if (!user || !user.isActive) {
          await recordLoginFailure(key, ip)
          return null
        }

        // ── Password verification ─────────────────────────────────────────
        // @node-rs/argon2 verifies Argon2id hashes (preferred) and Argon2i/d.
        // If the hash in the DB was created with bcrypt or plain SHA-256,
        // verify() will throw — we catch and log, then reject the login.
        // The operator must re-hash the password with Argon2id via the
        // admin credential management panel.
        let passwordValid = false
        try {
          // Check if hash is bcrypt (starts with $2a$, $2b$, or $2y$)
          if (user.passwordHash.startsWith('$2a$') || user.passwordHash.startsWith('$2b$') || user.passwordHash.startsWith('$2y$')) {
            passwordValid = await compare(password, user.passwordHash)
          } else {
            passwordValid = await verify(user.passwordHash, password)
          }
        } catch (err) {
          console.error(
            '[AUTH] Password verification failed.',
            'Expected Argon2id or Bcrypt. Check DB hash for user:', user.email,
            'Hash prefix:', user.passwordHash.substring(0, 24),
            'Error:', err instanceof Error ? err.message : String(err),
          )
        }
        if (!passwordValid) {
          await recordLoginFailure(key, ip)
          return null
        }
        await clearLoginFailures(key)

        // SECURITY: auto-generated portal passwords (phone number, registration
        // number, Student@YYYY!) are guessable, so they never open an account.
        // Staff must issue a temporary password first (lib/portal-login.ts).
        if (await isDefaultPortalPassword(user.id, user.role, password)) {
          throw new DefaultPasswordSignin()
        }

        // ── Last-login update (fire-and-forget) ───────────────────────────
        // WHY fire-and-forget: we do not want a lastLogin update failure to
        // block the login response. Catch prevents unhandled rejection.
        prisma.user.update({
          where: { id: user.id },
          data:  { lastLogin: new Date() },
        }).catch(() => {})

        // ── Profile resolution ────────────────────────────────────────────
        // WHY after password verify: the expensive profile JOIN is only paid
        // for valid logins, not for every failed attempt (which would be the
        // common case under a credential-stuffing attack).
        const profile = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            admin:          { select: { firstName: true, lastName: true, campusId: true } },
            teacher:        { select: { firstName: true, lastName: true, campusId: true, profilePicture: true } },
            student:        { select: { firstName: true, lastName: true, profilePicture: true } },
            accountant:     { select: { firstName: true, lastName: true, campusId: true } },
            branchManager:  { select: { firstName: true, lastName: true, campusId: true } },
            secretary:      { select: { firstName: true, lastName: true, campusId: true } },
            marketingStaff: { select: { firstName: true, lastName: true, campusId: true } },
          },
        })

        const p =
          profile?.admin ??
          profile?.teacher ??
          profile?.student ??
          profile?.accountant ??
          profile?.branchManager ??
          profile?.secretary ??
          profile?.marketingStaff
        const name = p
          ? `${p.firstName} ${p.lastName}`
          : email.split('@')[0]

        const campusId =
          profile?.admin?.campusId          ??
          profile?.teacher?.campusId        ??
          profile?.accountant?.campusId     ??
          profile?.branchManager?.campusId  ??
          profile?.secretary?.campusId      ??
          profile?.marketingStaff?.campusId ??
          null

        const profilePicture =
          profile?.student?.profilePicture ??
          profile?.teacher?.profilePicture ??
          null

        // This object is passed to the jwt() callback as `user`.
        // All fields must be JSON-serialisable (no undefined, no circular refs).
        return {
          id:             user.id,
          email:          user.email,
          name,
          role:           user.role,
          campusId:       campusId ?? null,
          profilePicture: profilePicture ?? null,
          mustChangePassword: user.mustChangePassword,
        }
      },
    }),
  ],
})

/**
 * auth() — the NextAuth session, plus Permissions-page overrides loaded.
 *
 * WHY here: almost every API route starts with auth() (directly or through
 * requireSession) and then calls the synchronous checkPermission(). Loading the
 * overrides here makes them apply everywhere without touching 300+ routes.
 * The load is cached for 30s and never throws.
 */
export const auth = (async (...args: unknown[]) => {
  const result = await (nextAuthSession as (...a: unknown[]) => Promise<unknown>)(...args)
  await ensurePermissionOverrides()
  // auth() is also used as a middleware wrapper (auth(handler)); only plain
  // session lookups (no arguments) return a session object to re-check.
  // Deactivated accounts / revoked sessions -> null; role refreshed from the DB.
  if (args.length === 0) return guardSession(result as Parameters<typeof guardSession>[0])
  return result
}) as typeof nextAuthSession
