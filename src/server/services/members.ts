import { prisma } from '@/server/db';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { hashPassword } from '@/server/auth/password';
import { ALL_PERMISSIONS, WILDCARD, isPermissionKey } from '@/server/permissions';
import type { CreateMemberInput, RoleInput, UpdateMemberInput } from '@/lib/validation/users';

/**
 * Utilisateurs et roles d'une entreprise.
 *
 * Regle de securite centrale : une entreprise ne doit jamais pouvoir se
 * retrouver sans administrateur actif, sinon plus personne ne peut y gerer les
 * acces. Toutes les operations qui pourraient produire cet etat sont bloquees.
 */

export async function listMembers(companyId: string) {
  return prisma.membership.findMany({
    where: { companyId },
    include: {
      user: {
        select: { id: true, email: true, fullName: true, phone: true, lastLoginAt: true, isActive: true },
      },
      role: { select: { id: true, key: true, name: true } },
      defaultLocation: { select: { id: true, name: true } },
    },
    orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
  });
}

async function assertRoleBelongsToCompany(companyId: string, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, companyId },
    select: { id: true, key: true, permissions: true },
  });
  if (!role) throw new NotFoundError('Rôle introuvable pour cette entreprise.');
  return role;
}

async function assertLocationBelongsToCompany(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, companyId },
    select: { id: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable pour cette entreprise.');
}

function grantsFullAccess(permissions: readonly string[]): boolean {
  return permissions.includes(WILDCARD) || permissions.includes('settings.users');
}

/** Nombre d'utilisateurs actifs pouvant encore gerer les acces de l'entreprise. */
async function countActiveAdmins(companyId: string, excludeMembershipId?: string): Promise<number> {
  const memberships = await prisma.membership.findMany({
    where: {
      companyId,
      isActive: true,
      ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}),
      user: { isActive: true },
    },
    select: { role: { select: { permissions: true } } },
  });
  return memberships.filter((membership) => grantsFullAccess(membership.role.permissions)).length;
}

export async function createMember(companyId: string, input: CreateMemberInput) {
  await assertRoleBelongsToCompany(companyId, input.roleId);
  if (input.defaultLocationId) {
    await assertLocationBelongsToCompany(companyId, input.defaultLocationId);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existingUser) {
    const alreadyMember = await prisma.membership.findUnique({
      where: { userId_companyId: { userId: existingUser.id, companyId } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new ConflictError('Cette personne fait déjà partie de votre équipe.');
    }

    // Le compte existe deja (la personne travaille pour une autre entreprise de
    // la plateforme) : on cree l'appartenance sans toucher a son mot de passe.
    return prisma.membership.create({
      data: {
        companyId,
        userId: existingUser.id,
        roleId: input.roleId,
        defaultLocationId: input.defaultLocationId ?? null,
      },
      include: { user: true, role: true },
    });
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        passwordHash,
      },
    });

    return tx.membership.create({
      data: {
        companyId,
        userId: user.id,
        roleId: input.roleId,
        defaultLocationId: input.defaultLocationId ?? null,
      },
      include: { user: true, role: true },
    });
  });
}

export async function updateMember(
  companyId: string,
  membershipId: string,
  input: UpdateMemberInput,
) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyId },
    include: { role: { select: { permissions: true } } },
  });
  if (!membership) throw new NotFoundError('Utilisateur introuvable dans cette entreprise.');

  const newRole = await assertRoleBelongsToCompany(companyId, input.roleId);
  if (input.defaultLocationId) {
    await assertLocationBelongsToCompany(companyId, input.defaultLocationId);
  }

  // Retrograder ou desactiver le dernier administrateur rendrait l'entreprise
  // ingérable : plus personne ne pourrait redonner les droits.
  const wasAdmin = grantsFullAccess(membership.role.permissions);
  const willBeAdmin = input.isActive && grantsFullAccess(newRole.permissions);
  if (wasAdmin && !willBeAdmin) {
    const others = await countActiveAdmins(companyId, membershipId);
    if (others === 0) {
      throw new ValidationError(
        "Cette entreprise doit conserver au moins un administrateur actif. Nommez d'abord un autre administrateur.",
      );
    }
  }

  return prisma.membership.update({
    where: { id: membershipId },
    data: {
      roleId: input.roleId,
      defaultLocationId: input.defaultLocationId ?? null,
      isActive: input.isActive,
    },
    include: { user: true, role: true },
  });
}

export async function removeMember(companyId: string, membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyId },
    include: { role: { select: { permissions: true } } },
  });
  if (!membership) throw new NotFoundError('Utilisateur introuvable dans cette entreprise.');

  if (membership.isOwner) {
    throw new ValidationError(
      "Le propriétaire de l'entreprise ne peut pas être retiré de son équipe.",
    );
  }

  if (grantsFullAccess(membership.role.permissions)) {
    const others = await countActiveAdmins(companyId, membershipId);
    if (others === 0) {
      throw new ValidationError('Cette entreprise doit conserver au moins un administrateur actif.');
    }
  }

  // Retirer l'appartenance revoque immediatement les sessions ouvertes sur
  // cette entreprise (cascade sur `sessions.membershipId`).
  await prisma.membership.delete({ where: { id: membershipId } });
}

export async function listRoles(companyId: string) {
  return prisma.role.findMany({
    where: { companyId },
    include: { _count: { select: { memberships: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

/** Valide une liste de permissions soumise par l'interface. */
export function sanitisePermissions(permissions: readonly string[]): string[] {
  if (permissions.includes(WILDCARD)) return [WILDCARD];

  const unknown = permissions.filter((permission) => !isPermissionKey(permission));
  if (unknown.length > 0) {
    throw new ValidationError(`Permissions inconnues : ${unknown.join(', ')}.`);
  }
  // Deduplique en conservant l'ordre du catalogue, ce qui rend l'affichage
  // stable d'un enregistrement a l'autre.
  return ALL_PERMISSIONS.filter((permission) => permissions.includes(permission));
}

export async function createRole(companyId: string, input: RoleInput) {
  const permissions = sanitisePermissions(input.permissions);
  if (permissions.length === 0) {
    throw new ValidationError('Un rôle doit accorder au moins une permission.');
  }

  const key = input.name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 40);
  const duplicate = await prisma.role.findFirst({ where: { companyId, key }, select: { id: true } });
  if (duplicate) throw new ConflictError('Un rôle portant ce nom existe déjà.');

  return prisma.role.create({
    data: {
      companyId,
      key,
      name: input.name,
      description: input.description ?? null,
      permissions,
      isSystem: false,
    },
  });
}

export async function updateRole(companyId: string, roleId: string, input: RoleInput) {
  const role = await prisma.role.findFirst({ where: { id: roleId, companyId } });
  if (!role) throw new NotFoundError('Rôle introuvable.');

  const permissions = sanitisePermissions(input.permissions);
  if (permissions.length === 0) {
    throw new ValidationError('Un rôle doit accorder au moins une permission.');
  }

  // Le role ADMIN est le filet de securite de l'entreprise : son perimetre ne
  // peut pas etre reduit, sous peine de verrouiller definitivement l'acces.
  if (role.key === 'ADMIN' && !permissions.includes(WILDCARD)) {
    throw new ValidationError(
      "Le rôle Administrateur doit conserver l'accès complet. Créez un rôle personnalisé pour un périmètre restreint.",
    );
  }

  if (grantsFullAccess(role.permissions) && !grantsFullAccess(permissions)) {
    const holders = await prisma.membership.count({
      where: { companyId, roleId, isActive: true },
    });
    if (holders > 0) {
      const others = await countActiveAdmins(companyId);
      const remaining = others - holders;
      if (remaining <= 0) {
        throw new ValidationError(
          "Cette modification retirerait les droits d'administration au dernier administrateur actif.",
        );
      }
    }
  }

  return prisma.role.update({
    where: { id: roleId },
    data: { name: input.name, description: input.description ?? null, permissions },
  });
}

export async function deleteRole(companyId: string, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, companyId },
    include: { _count: { select: { memberships: true } } },
  });
  if (!role) throw new NotFoundError('Rôle introuvable.');

  if (role.isSystem) {
    throw new ValidationError(
      "Les rôles fournis avec GestiOne ne peuvent pas être supprimés. Vous pouvez modifier leurs permissions ou créer un rôle personnalisé.",
    );
  }

  if (role._count.memberships > 0) {
    throw new ValidationError(
      `Ce rôle est attribué a ${role._count.memberships} utilisateur(s). Réaffectez-les avant de le supprimer.`,
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
}
