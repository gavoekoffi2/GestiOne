import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { getCompanyOverview, getFirstSteps } from '@/server/services/onboarding';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { createInvoice } from '@/server/services/invoices';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

/**
 * Guide de demarrage.
 *
 * Une etape ne doit **jamais** s'afficher comme faite sans l'etre : le guide
 * perdrait sa seule utilite, qui est de dire ou l'on en est reellement. Chaque
 * etape est donc verifiee sur une base ou l'action a ete effectuee pour de bon.
 */

const product = {
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

beforeEach(async () => {
  await resetDatabase();
});

function step(steps: Array<{ key: string; done: boolean }>, key: string) {
  const found = steps.find((entry) => entry.key === key);
  if (!found) throw new Error(`Etape "${key}" absente du guide.`);
  return found;
}

describe('guide de demarrage', () => {
  it('part de quatre etapes, toutes a faire', async () => {
    const company = await createTestCompany();
    const overview = await getCompanyOverview(company.companyId);

    expect(overview.firstSteps).toHaveLength(4);
    expect(overview.firstSteps.every((entry) => entry.done)).toBe(false);
    expect(overview.hasActivity).toBe(false);
  });

  it('coche le catalogue des le premier article, et le stock seulement s il existe', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, product, company.userId);

    const sansStock = await getCompanyOverview(company.companyId);
    expect(step(sansStock.firstSteps, 'products').done).toBe(true);
    expect(step(sansStock.firstSteps, 'stock').done).toBe(false);

    await createProduct(
      company.companyId,
      { ...product, name: 'Bidon d huile 5 L', initialStock: 12_000n },
      company.userId,
    );

    const avecStock = await getCompanyOverview(company.companyId);
    expect(step(avecStock.firstSteps, 'stock').done).toBe(true);
  });

  it('coche la premiere vente et le premier client', async () => {
    const company = await createTestCompany();
    const context = await serviceContext(company.companyId, company.userId);
    const created = await createProduct(
      company.companyId,
      { ...product, initialStock: 10_000n },
      company.userId,
    );

    await createPartner(company.companyId, 'CUSTOMER', {
      name: 'Ama Diallo',
      companyName: undefined,
      phone: undefined,
      secondPhone: undefined,
      email: undefined,
      addressLine: undefined,
      city: undefined,
      countryCode: undefined,
      taxNumber: undefined,
      creditLimit: 0n,
      notes: undefined,
      isActive: true,
    });

    await createInvoice(context, {
      locationId: company.locationId,
      issue: true,
      lines: [{ productId: created.id, quantity: 1_000n }],
    });

    const overview = await getCompanyOverview(company.companyId);
    expect(step(overview.firstSteps, 'sale').done).toBe(true);
    expect(step(overview.firstSteps, 'customers').done).toBe(true);
    expect(overview.hasActivity).toBe(true);
  });

  it('ne compte pas une facture annulee comme une premiere vente', async () => {
    const company = await createTestCompany();
    const context = await serviceContext(company.companyId, company.userId);
    const created = await createProduct(
      company.companyId,
      { ...product, initialStock: 10_000n },
      company.userId,
    );

    const invoice = await createInvoice(context, {
      locationId: company.locationId,
      issue: true,
      lines: [{ productId: created.id, quantity: 1_000n }],
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });

    const overview = await getCompanyOverview(company.companyId);
    expect(step(overview.firstSteps, 'sale').done).toBe(false);
  });

  it('donne le meme etat par le chemin leger du tableau de bord', async () => {
    const company = await createTestCompany();
    await createProduct(company.companyId, { ...product, initialStock: 3_000n }, company.userId);

    const complet = await getCompanyOverview(company.companyId);
    const leger = await getFirstSteps(company.companyId);

    expect(leger.map((entry) => [entry.key, entry.done])).toEqual(
      complet.firstSteps.map((entry) => [entry.key, entry.done]),
    );
  });

  it("n'observe que l'entreprise demandee", async () => {
    const alpha = await createTestCompany();
    const beta = await createTestCompany();
    await createProduct(beta.companyId, { ...product, initialStock: 5_000n }, beta.userId);

    const overview = await getCompanyOverview(alpha.companyId);
    expect(step(overview.firstSteps, 'products').done).toBe(false);
    expect(step(overview.firstSteps, 'stock').done).toBe(false);
  });
});
