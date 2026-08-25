import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { authenticate, changePassword, registerAccount } from '@/server/services/accounts';
import { ConflictError, UnauthorizedError } from '@/server/errors';
import { PasswordError } from '@/server/auth/password';
import { resetDatabase } from '../helpers';

const baseInput = {
  fullName: 'Kofi Mensah',
  email: 'kofi@boutique.test',
  phone: '+225 07 00 00 00 00',
  password: 'MotDePasse1',
  companyName: 'Boutique Kofi',
  countryCode: 'CI',
  currencyCode: 'XOF',
};

beforeEach(async () => {
  await resetDatabase();
});

describe('registerAccount', () => {
  it("cree l'utilisateur, l'entreprise, ses roles et son point de vente", async () => {
    const result = await registerAccount(baseInput);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.email).toBe('kofi@boutique.test');
    expect(user.passwordHash).not.toContain('MotDePasse1');

    const company = await prisma.company.findUniqueOrThrow({ where: { id: result.companyId } });
    expect(company.name).toBe('Boutique Kofi');
    expect(company.currencyCode).toBe('XOF');
    expect(company.slug).toBe('boutique-kofi');

    const roles = await prisma.role.findMany({ where: { companyId: result.companyId } });
    expect(roles.map((role) => role.key).sort()).toEqual([
      'ADMIN',
      'CASHIER',
      'MANAGER',
      'SALES',
      'STOCK',
    ]);

    const locations = await prisma.location.findMany({ where: { companyId: result.companyId } });
    expect(locations).toHaveLength(1);
    expect(locations[0]?.isDefault).toBe(true);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: result.membershipId },
      include: { role: true },
    });
    expect(membership.isOwner).toBe(true);
    expect(membership.role.key).toBe('ADMIN');
    expect(membership.defaultLocationId).toBe(locations[0]?.id);
  });

  it('refuse une adresse email deja utilisee', async () => {
    await registerAccount(baseInput);
    await expect(registerAccount(baseInput)).rejects.toThrow(ConflictError);

    // L'echec ne doit laisser aucune entreprise supplementaire derriere lui.
    expect(await prisma.company.count()).toBe(1);
  });

  it('genere un slug distinct pour deux entreprises homonymes', async () => {
    await registerAccount(baseInput);
    await registerAccount({ ...baseInput, email: 'autre@boutique.test' });

    const companies = await prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
    expect(companies.map((company) => company.slug)).toEqual(['boutique-kofi', 'boutique-kofi-2']);
  });

  it("n'ecrit rien si la devise n'existe pas", async () => {
    await expect(
      registerAccount({ ...baseInput, currencyCode: 'ZZZ' }),
    ).rejects.toThrow();

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.company.count()).toBe(0);
  });

  it('refuse un mot de passe faible avant toute ecriture', async () => {
    await expect(registerAccount({ ...baseInput, password: 'faible' })).rejects.toThrow(
      PasswordError,
    );
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('authenticate', () => {
  beforeEach(async () => {
    await registerAccount(baseInput);
  });

  it('accepte les bons identifiants', async () => {
    const user = await authenticate('kofi@boutique.test', 'MotDePasse1');
    expect(user.email).toBe('kofi@boutique.test');
    expect(user.membershipId).not.toBeNull();
  });

  it('refuse un mauvais mot de passe', async () => {
    await expect(authenticate('kofi@boutique.test', 'Incorrect1')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("ne revele pas si l'adresse email existe", async () => {
    const unknownEmail = authenticate('inconnu@test.local', 'MotDePasse1').catch((e) => e.message);
    const wrongPassword = authenticate('kofi@boutique.test', 'Incorrect1').catch((e) => e.message);
    expect(await unknownEmail).toBe(await wrongPassword);
  });

  it('refuse un compte desactive', async () => {
    await prisma.user.update({
      where: { email: 'kofi@boutique.test' },
      data: { isActive: false },
    });
    await expect(authenticate('kofi@boutique.test', 'MotDePasse1')).rejects.toThrow(
      /désactivé/,
    );
  });
});

describe('changePassword', () => {
  it('exige le mot de passe actuel', async () => {
    const { userId } = await registerAccount(baseInput);
    await expect(changePassword(userId, 'Incorrect1', 'NouveauPass1')).rejects.toThrow(
      UnauthorizedError,
    );
    await expect(authenticate('kofi@boutique.test', 'MotDePasse1')).resolves.toBeDefined();
  });

  it('remplace effectivement le mot de passe', async () => {
    const { userId } = await registerAccount(baseInput);
    await changePassword(userId, 'MotDePasse1', 'NouveauPass1');

    await expect(authenticate('kofi@boutique.test', 'NouveauPass1')).resolves.toBeDefined();
    await expect(authenticate('kofi@boutique.test', 'MotDePasse1')).rejects.toThrow();
  });
});
