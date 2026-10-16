import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createLocation, deleteLocation } from '@/server/services/locations';
import { createPartner, deletePartner } from '@/server/services/partners';
import { createProduct } from '@/server/services/catalog';
import { recordEntry } from '@/server/services/stock';
import { createInvoice, getInvoice } from '@/server/services/invoices';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

/**
 * Regressions relevees par l'analyse globale d'octobre 2026.
 *
 * Chaque test reproduit un defaut constate sur la version deployee : il
 * echouait avant la correction.
 */

const productInput = {
  kind: 'GOOD' as const,
  name: 'Sac de riz 25 kg',
  sku: undefined,
  barcode: undefined,
  description: undefined,
  categoryId: undefined,
  unitId: undefined,
  supplierId: undefined,
  costPrice: 12_000n,
  salePrice: 15_000n,
  wholesalePrice: undefined,
  wholesaleFrom: 0n,
  specialPrice: undefined,
  minStock: 0n,
  isActive: true,
};

const partnerInput = {
  name: 'Ama Diallo',
  companyName: undefined,
  phone: undefined,
  secondPhone: undefined,
  email: undefined,
  addressLine: undefined,
  city: undefined,
  countryCode: undefined,
  taxNumber: undefined,
  creditLimit: 500_000n,
  notes: undefined,
  isActive: true,
};

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

describe('suppressions qui effacaient un historique', () => {
  it('un point de vente qui a eu du stock est desactive, pas supprime', async () => {
    const company = await createTestCompany();
    const location = await createLocation(company.companyId, depot);
    const product = await createProduct(company.companyId, productInput);
    await recordEntry(
      { companyId: company.companyId, userId: company.userId },
      { productId: product.id, locationId: location.id, quantity: 10_000n },
    );

    await deleteLocation(company.companyId, location.id);

    // La base supprime en cascade stock et mouvements : ils doivent survivre.
    const after = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    expect(after.isActive).toBe(false);
    expect(await prisma.stockMovement.count({ where: { locationId: location.id } })).toBe(1);
    expect(await prisma.stockLevel.count({ where: { locationId: location.id } })).toBe(1);
  });

  it('un point de vente jamais utilise est reellement supprime', async () => {
    const company = await createTestCompany();
    const location = await createLocation(company.companyId, depot);
    await deleteLocation(company.companyId, location.id);
    expect(await prisma.location.count({ where: { id: location.id } })).toBe(0);
  });

  it('un client qui a une facture est desactive : sa dette reste a son nom', async () => {
    const company = await createTestCompany();
    const ctx = await serviceContext(company.companyId, company.userId);
    const customer = await createPartner(company.companyId, 'CUSTOMER', partnerInput);
    const invoice = await createInvoice(ctx, {
      customerId: customer.id,
      issue: true,
      lines: [{ description: 'Prestation', quantity: 1_000n, unitPrice: 50_000n }],
    });

    await deletePartner(company.companyId, 'CUSTOMER', customer.id);

    const after = await prisma.partner.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.isActive).toBe(false);
    expect((await getInvoice(company.companyId, invoice.id)).customerId).toBe(customer.id);
  });

  it('un client sans aucun document est reellement supprime', async () => {
    const company = await createTestCompany();
    const customer = await createPartner(company.companyId, 'CUSTOMER', partnerInput);
    await deletePartner(company.companyId, 'CUSTOMER', customer.id);
    expect(await prisma.partner.count({ where: { id: customer.id } })).toBe(0);
  });
});
