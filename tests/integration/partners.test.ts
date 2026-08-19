import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  countPartners,
  createPartner,
  deletePartner,
  getPartner,
  listPartners,
  updatePartner,
} from '@/server/services/partners';
import { createProduct } from '@/server/services/catalog';
import { ConflictError, NotFoundError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

const base = {
  name: 'Ama Diallo',
  companyName: 'Boutique Ama',
  phone: '+225 07 11 22 33 44',
  secondPhone: undefined,
  email: 'ama@client.test',
  addressLine: 'Rue 12',
  city: 'Abidjan',
  countryCode: 'CI',
  taxNumber: undefined,
  creditLimit: 50_000n,
  notes: undefined,
  isActive: true,
};

beforeEach(async () => {
  await resetDatabase();
});

describe('createPartner', () => {
  it('cree un client avec un code sequentiel', async () => {
    const company = await createTestCompany();

    const first = await createPartner(company.companyId, 'CUSTOMER', base);
    const second = await createPartner(company.companyId, 'CUSTOMER', { ...base, name: 'Yao' });

    expect(first.code).toBe('CLI-0001');
    expect(second.code).toBe('CLI-0002');
    expect(first.creditLimit).toBe(50_000n);
  });

  it('numerote clients et fournisseurs separement', async () => {
    const company = await createTestCompany();
    const customer = await createPartner(company.companyId, 'CUSTOMER', base);
    const supplier = await createPartner(company.companyId, 'SUPPLIER', { ...base, name: 'Grossiste' });

    expect(customer.code).toBe('CLI-0001');
    expect(supplier.code).toBe('FRN-0001');
  });

  it('numerote chaque entreprise independamment', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await createPartner(alpha.companyId, 'CUSTOMER', base);
    const betaFirst = await createPartner(beta.companyId, 'CUSTOMER', base);
    expect(betaFirst.code).toBe('CLI-0001');
  });

  it('ne reattribue jamais le code d un tiers supprime', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', base);
    const second = await createPartner(company.companyId, 'CUSTOMER', { ...base, name: 'Yao' });

    await deletePartner(company.companyId, 'CUSTOMER', second.id);

    // CLI-0002 a pu figurer sur un bon de livraison ou un recu : le rendre a un
    // autre client rendrait ces documents trompeurs.
    const third = await createPartner(company.companyId, 'CUSTOMER', { ...base, name: 'Koffi' });
    expect(third.code).toBe('CLI-0003');
    expect(await prisma.partner.count({ where: { companyId: company.companyId } })).toBe(2);
  });

  it("n'attribue jamais deux fois le meme code sous concurrence", async () => {
    const company = await createTestCompany();
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createPartner(company.companyId, 'CUSTOMER', { ...base, name: `Client ${index}` }),
      ),
    );
    expect(new Set(created.map((partner) => partner.code)).size).toBe(12);
  });
});

describe('listPartners', () => {
  it('ne rend que les tiers de la bonne entreprise et du bon type', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });

    await createPartner(alpha.companyId, 'CUSTOMER', base);
    await createPartner(alpha.companyId, 'SUPPLIER', { ...base, name: 'Grossiste' });
    await createPartner(beta.companyId, 'CUSTOMER', { ...base, name: 'Client Beta' });

    const customers = await listPartners(alpha.companyId, 'CUSTOMER', { page: 1, pageSize: 25 });
    expect(customers.total).toBe(1);
    expect(customers.items[0]?.name).toBe('Ama Diallo');

    const suppliers = await listPartners(alpha.companyId, 'SUPPLIER', { page: 1, pageSize: 25 });
    expect(suppliers.total).toBe(1);
    expect(suppliers.items[0]?.name).toBe('Grossiste');
  });

  it('recherche par nom, code et telephone', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', base);
    await createPartner(company.companyId, 'CUSTOMER', {
      ...base,
      name: 'Yao Kouassi',
      phone: '+225 05 99 88 77 66',
      email: undefined,
    });

    const byName = await listPartners(company.companyId, 'CUSTOMER', {
      page: 1,
      pageSize: 25,
      search: 'kouassi',
    });
    expect(byName.total).toBe(1);

    const byPhone = await listPartners(company.companyId, 'CUSTOMER', {
      page: 1,
      pageSize: 25,
      search: '99 88',
    });
    expect(byPhone.total).toBe(1);
    expect(byPhone.items[0]?.name).toBe('Yao Kouassi');

    const byCode = await listPartners(company.companyId, 'CUSTOMER', {
      page: 1,
      pageSize: 25,
      search: 'CLI-0001',
    });
    expect(byCode.total).toBe(1);
    expect(byCode.items[0]?.name).toBe('Ama Diallo');
  });

  it('masque les tiers inactifs par defaut', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', { ...base, isActive: false });

    expect((await listPartners(company.companyId, 'CUSTOMER', { page: 1, pageSize: 25 })).total).toBe(0);
    expect(
      (await listPartners(company.companyId, 'CUSTOMER', {
        page: 1,
        pageSize: 25,
        includeInactive: true,
      })).total,
    ).toBe(1);
  });

  it('pagine', async () => {
    const company = await createTestCompany();
    for (let index = 0; index < 7; index += 1) {
      await createPartner(company.companyId, 'CUSTOMER', { ...base, name: `Client ${index}` });
    }

    const page = await listPartners(company.companyId, 'CUSTOMER', { page: 2, pageSize: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.pageCount).toBe(3);
    expect(page.total).toBe(7);
  });
});

describe('isolation', () => {
  it('refuse de lire, modifier ou supprimer le tiers d une autre entreprise', async () => {
    const alpha = await createTestCompany({ companyName: 'Alpha' });
    const beta = await createTestCompany({ companyName: 'Beta' });
    const betaCustomer = await createPartner(beta.companyId, 'CUSTOMER', base);

    await expect(getPartner(alpha.companyId, 'CUSTOMER', betaCustomer.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      updatePartner(alpha.companyId, 'CUSTOMER', betaCustomer.id, { ...base, name: 'Detourne' }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      deletePartner(alpha.companyId, 'CUSTOMER', betaCustomer.id),
    ).rejects.toThrow(NotFoundError);

    const untouched = await prisma.partner.findUniqueOrThrow({ where: { id: betaCustomer.id } });
    expect(untouched.name).toBe('Ama Diallo');
  });

  it('refuse de lire un fournisseur par la porte des clients', async () => {
    const company = await createTestCompany();
    const supplier = await createPartner(company.companyId, 'SUPPLIER', base);

    await expect(getPartner(company.companyId, 'CUSTOMER', supplier.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('deletePartner', () => {
  it('desactive un fournisseur encore reference par un article', async () => {
    const company = await createTestCompany();
    const supplier = await createPartner(company.companyId, 'SUPPLIER', base);

    await createProduct(company.companyId, {
      kind: 'GOOD',
      name: 'Sac de riz 25 kg',
      sku: undefined,
      barcode: undefined,
      description: undefined,
      categoryId: undefined,
      unitId: undefined,
      supplierId: supplier.id,
      costPrice: 12_000n,
      salePrice: 15_000n,
      wholesalePrice: undefined,
      wholesaleFrom: 0n,
      specialPrice: undefined,
      minStock: 5000n,
      isActive: true,
    });

    const result = await deletePartner(company.companyId, 'SUPPLIER', supplier.id);
    expect(result?.isActive).toBe(false);
    expect(await prisma.partner.count({ where: { id: supplier.id } })).toBe(1);
  });
});

describe('countPartners', () => {
  it('compte actifs et inactifs', async () => {
    const company = await createTestCompany();
    await createPartner(company.companyId, 'CUSTOMER', base);
    await createPartner(company.companyId, 'CUSTOMER', { ...base, name: 'Inactif', isActive: false });

    expect(await countPartners(company.companyId, 'CUSTOMER')).toEqual({
      total: 2,
      active: 1,
      inactive: 1,
    });
  });
});
