import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  createMember,
  createRole,
  deleteRole,
  listMembers,
  removeMember,
  sanitisePermissions,
  updateMember,
  updateRole,
} from '@/server/services/members';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { authenticate } from '@/server/services/accounts';
import { createTestCompany, resetDatabase } from '../helpers';

async function roleId(companyId: string, key: string) {
  const role = await prisma.role.findFirstOrThrow({ where: { companyId, key } });
  return role.id;
}

beforeEach(async () => {
  await resetDatabase();
});

describe('createMember', () => {
  it('cree le compte et son appartenance', async () => {
    const company = await createTestCompany();
    const membership = await createMember(company.companyId, {
      fullName: 'Ama Diallo',
      email: 'ama@equipe.test',
      phone: '+225 07 11 22 33 44',
      password: 'MotDePasse1',
      roleId: await roleId(company.companyId, 'CASHIER'),
      defaultLocationId: company.locationId,
    });

    expect(membership.user.email).toBe('ama@equipe.test');
    expect(membership.role.key).toBe('CASHIER');
    expect(membership.isOwner).toBe(false);

    // Le collaborateur peut reellement se connecter avec le mot de passe fourni.
    await expect(authenticate('ama@equipe.test', 'MotDePasse1')).resolves.toBeDefined();
  });

  it('refuse un role appartenant a une autre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(
      createMember(alpha.companyId, {
        fullName: 'Intrus',
        email: 'intrus@test.local',
        phone: undefined,
        password: 'MotDePasse1',
        roleId: await roleId(beta.companyId, 'ADMIN'),
        defaultLocationId: undefined,
      }),
    ).rejects.toThrow(NotFoundError);

    expect(await prisma.user.count({ where: { email: 'intrus@test.local' } })).toBe(0);
  });

  it("refuse un point de vente appartenant a une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(
      createMember(alpha.companyId, {
        fullName: 'Intrus',
        email: 'intrus2@test.local',
        phone: undefined,
        password: 'MotDePasse1',
        roleId: await roleId(alpha.companyId, 'SALES'),
        defaultLocationId: beta.locationId,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rattache un compte existant sans recreer d utilisateur', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta', email: 'partage@test.local' });

    const membership = await createMember(alpha.companyId, {
      fullName: 'Ignore',
      email: 'partage@test.local',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: await roleId(alpha.companyId, 'SALES'),
      defaultLocationId: undefined,
    });

    expect(membership.userId).toBe(beta.userId);
    expect(await prisma.user.count()).toBe(2);
  });

  it('refuse un doublon dans la meme entreprise', async () => {
    const company = await createTestCompany();
    const input = {
      fullName: 'Ama Diallo',
      email: 'ama@equipe.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: await roleId(company.companyId, 'SALES'),
      defaultLocationId: undefined,
    };
    await createMember(company.companyId, input);
    await expect(createMember(company.companyId, input)).rejects.toThrow(ConflictError);
  });
});

describe('listMembers', () => {
  it('ne rend que les membres de l entreprise demandee', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await createMember(alpha.companyId, {
      fullName: 'Ama',
      email: 'ama@alpha.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: await roleId(alpha.companyId, 'SALES'),
      defaultLocationId: undefined,
    });

    const alphaMembers = await listMembers(alpha.companyId);
    const betaMembers = await listMembers(beta.companyId);

    expect(alphaMembers).toHaveLength(2);
    expect(betaMembers).toHaveLength(1);
    expect(betaMembers[0]?.user.email).toBe(beta.email);
  });
});

describe('protection du dernier administrateur', () => {
  it('refuse de retrograder le seul administrateur', async () => {
    const company = await createTestCompany();
    await expect(
      updateMember(company.companyId, company.membershipId, {
        roleId: await roleId(company.companyId, 'CASHIER'),
        defaultLocationId: undefined,
        isActive: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse de desactiver le seul administrateur', async () => {
    const company = await createTestCompany();
    await expect(
      updateMember(company.companyId, company.membershipId, {
        roleId: await roleId(company.companyId, 'ADMIN'),
        defaultLocationId: undefined,
        isActive: false,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('autorise la retrogradation des lors qu un autre administrateur existe', async () => {
    const company = await createTestCompany();
    await createMember(company.companyId, {
      fullName: 'Second admin',
      email: 'admin2@test.local',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: await roleId(company.companyId, 'ADMIN'),
      defaultLocationId: undefined,
    });

    const updated = await updateMember(company.companyId, company.membershipId, {
      roleId: await roleId(company.companyId, 'MANAGER'),
      defaultLocationId: undefined,
      isActive: true,
    });
    expect(updated.role.key).toBe('MANAGER');
  });

  it('refuse de retirer le proprietaire', async () => {
    const company = await createTestCompany();
    await expect(removeMember(company.companyId, company.membershipId)).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuse de vider les permissions du role Administrateur", async () => {
    const company = await createTestCompany();
    await expect(
      updateRole(company.companyId, await roleId(company.companyId, 'ADMIN'), {
        name: 'Administrateur',
        description: undefined,
        permissions: ['sales.read'],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('revoque les sessions liees quand un membre est retire', async () => {
    const company = await createTestCompany();
    const member = await createMember(company.companyId, {
      fullName: 'Ama',
      email: 'ama@equipe.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: await roleId(company.companyId, 'SALES'),
      defaultLocationId: undefined,
    });

    await prisma.session.create({
      data: {
        tokenHash: 'hash-de-test',
        userId: member.userId,
        membershipId: member.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await removeMember(company.companyId, member.id);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('sanitisePermissions', () => {
  it('reduit le caractere generique a lui-meme', () => {
    expect(sanitisePermissions(['*', 'sales.read'])).toEqual(['*']);
  });

  it('rejette une permission inconnue', () => {
    expect(() => sanitisePermissions(['sales.read', 'tout.pouvoir'])).toThrow(ValidationError);
  });

  it('deduplique et ordonne selon le catalogue', () => {
    const result = sanitisePermissions(['sales.read', 'customers.read', 'sales.read']);
    expect(result).toEqual(['customers.read', 'sales.read']);
  });
});

describe('roles personnalises', () => {
  it('cree, modifie et supprime un role personnalise', async () => {
    const company = await createTestCompany();

    const role = await createRole(company.companyId, {
      name: 'Livreur',
      description: 'Consultation des ventes uniquement.',
      permissions: ['dashboard.view', 'sales.read'],
    });
    expect(role.key).toBe('LIVREUR');
    expect(role.isSystem).toBe(false);

    const updated = await updateRole(company.companyId, role.id, {
      name: 'Livreur',
      description: undefined,
      permissions: ['sales.read'],
    });
    expect(updated.permissions).toEqual(['sales.read']);

    await deleteRole(company.companyId, role.id);
    expect(await prisma.role.count({ where: { companyId: company.companyId } })).toBe(5);
  });

  it('refuse un role sans aucune permission', async () => {
    const company = await createTestCompany();
    await expect(
      createRole(company.companyId, { name: 'Vide', description: undefined, permissions: [] }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse de supprimer un role systeme', async () => {
    const company = await createTestCompany();
    await expect(
      deleteRole(company.companyId, await roleId(company.companyId, 'SALES')),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse de supprimer un role encore attribue', async () => {
    const company = await createTestCompany();
    const role = await createRole(company.companyId, {
      name: 'Livreur',
      description: undefined,
      permissions: ['sales.read'],
    });
    await createMember(company.companyId, {
      fullName: 'Yao',
      email: 'yao@equipe.test',
      phone: undefined,
      password: 'MotDePasse1',
      roleId: role.id,
      defaultLocationId: undefined,
    });

    await expect(deleteRole(company.companyId, role.id)).rejects.toThrow(ValidationError);
  });

  it('refuse de modifier le role d une autre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(
      updateRole(alpha.companyId, await roleId(beta.companyId, 'SALES'), {
        name: 'Detourne',
        description: undefined,
        permissions: ['*'],
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
