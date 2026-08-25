import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { SESSION_COOKIE_NAME, hashToken } from '@/server/auth/session';
import { hasPermission, type PermissionKey } from '@/server/permissions';

/**
 * Contexte de requete.
 *
 * C'est le seul endroit ou l'entreprise active est determinee. Tous les
 * services metier recoivent ensuite `ctx.companyId` : aucune route ne construit
 * elle-meme un filtre d'entreprise, ce qui evite la classe de bugs "j'ai oublie
 * le where companyId" qui exposerait les donnees d'une autre PME.
 */

export interface TenantContext {
  sessionId: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  currencyCode: string;
  locale: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  isOwner: boolean;
  defaultLocationId: string | null;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  memberships: Array<{
    id: string;
    companyId: string;
    companyName: string;
    companySlug: string;
    roleName: string;
    isOwner: boolean;
  }>;
  activeMembershipId: string | null;
}

/** Resout une session a partir du jeton brut. Sans dependance a Next : testable. */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            where: { isActive: true },
            include: {
              company: { select: { id: true, name: true, slug: true } },
              role: { select: { name: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    email: session.user.email,
    fullName: session.user.fullName,
    activeMembershipId: session.membershipId,
    memberships: session.user.memberships.map((membership) => ({
      id: membership.id,
      companyId: membership.companyId,
      companyName: membership.company.name,
      companySlug: membership.company.slug,
      roleName: membership.role.name,
      isOwner: membership.isOwner,
    })),
  };
}

/** Charge le contexte complet pour une appartenance donnee. */
export async function loadTenantContext(
  sessionId: string,
  userId: string,
  membershipId: string,
): Promise<TenantContext | null> {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, userId, isActive: true },
    include: {
      company: { select: { id: true, name: true, slug: true, currencyCode: true, locale: true } },
      role: { select: { key: true, name: true, permissions: true } },
      user: { select: { email: true, fullName: true } },
    },
  });

  if (!membership) return null;

  return {
    sessionId,
    userId,
    userEmail: membership.user.email,
    userFullName: membership.user.fullName,
    companyId: membership.companyId,
    companyName: membership.company.name,
    companySlug: membership.company.slug,
    currencyCode: membership.company.currencyCode,
    locale: membership.company.locale,
    membershipId: membership.id,
    roleKey: membership.role.key,
    roleName: membership.role.name,
    permissions: membership.role.permissions,
    isOwner: membership.isOwner,
    defaultLocationId: membership.defaultLocationId,
  };
}

async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

/**
 * Session courante, ou `null` si le visiteur n'est pas connecte.
 *
 * Memoisee pour la duree d'une requete (`cache` de React). Un rendu de page
 * traverse le layout, la page et plusieurs composants serveur, qui reclamaient
 * chacun le contexte : la meme session etait relue cinq a six fois par
 * affichage. La memoisation est strictement par requete — deux visiteurs ne
 * partagent jamais un contexte.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  return resolveSession(await readSessionToken());
});

/**
 * Contexte courant, ou `null`. Utilise par les layouts qui doivent decider
 * eux-memes de la redirection.
 */
export const getTenantContext = cache(async function getTenantContext(): Promise<TenantContext | null> {
  const session = await getSessionUser();
  if (!session) return null;

  // Une session sans entreprise active retombe sur la premiere appartenance :
  // le cas se produit apres une inscription ou si l'acces a ete retire.
  const membershipId =
    session.activeMembershipId &&
    session.memberships.some((membership) => membership.id === session.activeMembershipId)
      ? session.activeMembershipId
      : (session.memberships[0]?.id ?? null);

  if (!membershipId) return null;

  return loadTenantContext(session.sessionId, session.userId, membershipId);
});

/** Contexte courant ou erreur 401 : point d'entree de toute route protegee. */
export async function requireTenant(): Promise<TenantContext> {
  const context = await getTenantContext();
  if (!context) throw new UnauthorizedError();
  return context;
}

/** Verifie une permission cote serveur. Ne jamais s'appuyer sur l'interface. */
export function requirePermission(context: TenantContext, permission: PermissionKey): void {
  if (!hasPermission(context.permissions, permission)) {
    throw new ForbiddenError(
      `Action refusée : la permission "${permission}" est requise pour votre rôle (${context.roleName}).`,
    );
  }
}

export async function requireTenantWith(permission: PermissionKey): Promise<TenantContext> {
  const context = await requireTenant();
  requirePermission(context, permission);
  return context;
}

export function can(context: TenantContext | null, permission: PermissionKey): boolean {
  if (!context) return false;
  return hasPermission(context.permissions, permission);
}
