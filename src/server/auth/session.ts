import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/server/db';

/**
 * Sessions opaques.
 *
 * Le jeton en clair est genere une seule fois et ne quitte jamais le cookie
 * httpOnly. La base ne conserve que son empreinte SHA-256 : une fuite de la
 * table `sessions` ne permet donc pas de se faire passer pour un utilisateur.
 * Contrairement a un JWT, une session peut etre revoquee instantanement.
 */

export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'gestione_session';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateSessionInput {
  userId: string;
  membershipId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: input.userId,
      membershipId: input.membershipId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  return { token, expiresAt, sessionId: session.id };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Change l'entreprise active d'une session (utilisateur multi-entreprises). */
export async function switchSessionMembership(
  token: string,
  membershipId: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { membershipId },
  });
}

export const sessionCookieOptions = (expiresAt: Date) =>
  ({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
