import { prisma } from '@/server/db';
import { ConflictError, UnauthorizedError } from '@/server/errors';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { provisionCompany } from '@/server/services/companies';
import type { RegisterInput } from '@/lib/validation/auth';

/**
 * Inscription et connexion.
 *
 * L'inscription cree l'utilisateur **et** son entreprise dans une seule
 * transaction : un compte sans entreprise serait inutilisable et laisserait une
 * ligne orpheline en base.
 */

export interface RegisterResult {
  userId: string;
  companyId: string;
  membershipId: string;
}

export async function registerAccount(input: RegisterInput): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError('Un compte existe deja avec cette adresse email.');
  }

  // Le hachage scrypt prend volontairement du temps : il est fait hors
  // transaction pour ne pas garder un verrou de base ouvert inutilement.
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone ?? null,
      },
      select: { id: true },
    });

    const company = await provisionCompany(tx, {
      name: input.companyName,
      countryCode: input.countryCode,
      currencyCode: input.currencyCode,
      ownerUserId: user.id,
    });

    return {
      userId: user.id,
      companyId: company.companyId,
      membershipId: company.membershipId,
    };
  });
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  membershipId: string | null;
}

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      },
    },
  });

  // Meme message et meme cout approximatif que le compte existe ou non : sinon
  // le formulaire de connexion devient un oracle permettant d'enumerer les
  // adresses email inscrites.
  const genericFailure = new UnauthorizedError('Email ou mot de passe incorrect.');

  if (!user) {
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    throw genericFailure;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw genericFailure;

  if (!user.isActive) {
    throw new UnauthorizedError('Ce compte est desactive. Contactez votre administrateur.');
  }

  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    membershipId: user.memberships[0]?.id ?? null,
  };
}

export async function touchLastLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Mot de passe actuel incorrect.');

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
