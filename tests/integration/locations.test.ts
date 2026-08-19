import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  updateLocation,
} from '@/server/services/locations';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

const depot = {
  name: 'Depot Yopougon',
  code: 'YOP',
  kind: 'WAREHOUSE' as const,
  addressLine: undefined,
  city: 'Abidjan',
  phone: undefined,
  isDefault: false,
  isActive: true,
};

beforeEach(async () => {
  await resetDatabase();
});

describe('createLocation', () => {
  it('ajoute un point de vente', async () => {
    const company = await createTestCompany();
    const created = await createLocation(company.companyId, depot);

    expect(created.code).toBe('YOP');
    expect(await listLocations(company.companyId)).toHaveLength(2);
  });

  it('refuse un code deja utilise dans la meme entreprise', async () => {
    const company = await createTestCompany();
    await createLocation(company.companyId, depot);
    await expect(createLocation(company.companyId, depot)).rejects.toThrow(ConflictError);
  });

  it('autorise le meme code dans deux entreprises differentes', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(createLocation(alpha.companyId, depot)).resolves.toBeDefined();
    await expect(createLocation(beta.companyId, depot)).resolves.toBeDefined();
  });

  it("transfere le drapeau par defaut a un seul point de vente", async () => {
    const company = await createTestCompany();
    await createLocation(company.companyId, { ...depot, isDefault: true });

    const locations = await listLocations(company.companyId);
    expect(locations.filter((location) => location.isDefault)).toHaveLength(1);
    expect(locations.find((location) => location.isDefault)?.code).toBe('YOP');
  });
});

describe('getLocation', () => {
  it("refuse le point de vente d'une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(getLocation(alpha.companyId, beta.locationId)).rejects.toThrow(NotFoundError);
  });
});

describe('updateLocation', () => {
  it('modifie un point de vente', async () => {
    const company = await createTestCompany();
    const created = await createLocation(company.companyId, depot);

    const updated = await updateLocation(company.companyId, created.id, {
      ...depot,
      name: 'Depot Yopougon 2',
      city: 'Yopougon',
    });
    expect(updated.name).toBe('Depot Yopougon 2');
  });

  it('refuse de modifier celui d une autre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await expect(updateLocation(alpha.companyId, beta.locationId, depot)).rejects.toThrow(
      NotFoundError,
    );

    // Le point de vente de Beta est intact.
    const untouched = await prisma.location.findUniqueOrThrow({ where: { id: beta.locationId } });
    expect(untouched.code).toBe('PRINCIPAL');
  });

  it('refuse un code deja pris par un autre point de vente', async () => {
    const company = await createTestCompany();
    const created = await createLocation(company.companyId, depot);

    await expect(
      updateLocation(company.companyId, created.id, { ...depot, code: 'PRINCIPAL' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('deleteLocation', () => {
  it('refuse de supprimer le dernier point de vente actif', async () => {
    const company = await createTestCompany();
    await expect(deleteLocation(company.companyId, company.locationId)).rejects.toThrow(
      ValidationError,
    );
  });

  it('supprime un point de vente inutilise', async () => {
    const company = await createTestCompany();
    const created = await createLocation(company.companyId, depot);

    await deleteLocation(company.companyId, created.id);
    expect(await listLocations(company.companyId)).toHaveLength(1);
  });

  it('desactive plutot que supprimer un point de vente encore rattache a un utilisateur', async () => {
    const company = await createTestCompany();
    const created = await createLocation(company.companyId, depot);
    await prisma.membership.update({
      where: { id: company.membershipId },
      data: { defaultLocationId: created.id },
    });

    await deleteLocation(company.companyId, created.id);

    const kept = await prisma.location.findUniqueOrThrow({ where: { id: created.id } });
    expect(kept.isActive).toBe(false);
  });

  it("refuse de supprimer le point de vente d'une autre entreprise", async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    await createLocation(alpha.companyId, depot);

    await expect(deleteLocation(alpha.companyId, beta.locationId)).rejects.toThrow(NotFoundError);
  });
});
