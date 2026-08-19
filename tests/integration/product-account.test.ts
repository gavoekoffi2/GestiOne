import { beforeEach, describe, expect, it } from 'vitest';
import { getProductAccount } from '@/server/services/product-account';
import { cancelInvoice, createInvoice, issueInvoice } from '@/server/services/invoices';
import { createProduct, updateProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { createLocation } from '@/server/services/locations';
import { recordEntry, recordExit } from '@/server/services/stock';
import { NotFoundError } from '@/server/errors';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

/**
 * Fiche article : stock, ventes et marge.
 *
 * L'enjeu principal est la marge. Elle se calcule sur le cout fige dans les
 * lignes de facture, pas sur le prix d'achat courant : si le fournisseur
 * augmente ses tarifs, les ventes deja realisees ne doivent pas devenir
 * retroactivement moins rentables.
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

const depotInput = {
  name: 'Depot Yopougon',
  code: 'YOP',
  kind: 'WAREHOUSE' as const,
  addressLine: undefined,
  city: undefined,
  phone: undefined,
  isDefault: false,
  isActive: true,
};

const customerInput = {
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

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);
  const customer = await createPartner(company.companyId, 'CUSTOMER', customerInput);

  await recordEntry(
    { companyId: company.companyId, userId: company.userId },
    { productId: product.id, locationId: company.locationId, quantity: 100_000n },
  );

  return { ...company, ctx, productId: product.id, customerId: customer.id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('stock de la fiche article', () => {
  it('totalise les soldes de tous les points de vente', async () => {
    const s = await setup();
    const depot = await createLocation(s.companyId, depotInput);

    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: depot.id, quantity: 25_000n },
    );

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.totalQuantity).toBe(125_000n);
    expect(account.levels).toHaveLength(2);
    // 125 unites a 12 000 l'unite.
    expect(account.stockValue).toBe(1_500_000n);
  });

  it('signale les points de vente sous le seuil, et eux seuls', async () => {
    const s = await setup();
    const depot = await createLocation(s.companyId, depotInput);
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: depot.id, quantity: 2_000n },
    );

    await updateProduct(s.companyId, s.productId, { ...productInput, minStock: 10_000n });

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.lowLocations).toHaveLength(1);
    expect(account.lowLocations[0]?.locationName).toBe('Depot Yopougon');
    expect(account.lowLocations[0]?.quantity).toBe(2_000n);
  });

  it("ne signale aucune rupture quand aucun seuil n'est defini", async () => {
    const s = await setup();
    await recordExit(
      { companyId: s.companyId, userId: s.userId },
      {
        productId: s.productId,
        locationId: s.locationId,
        quantity: 100_000n,
        reason: 'Perte',
      },
    );

    const account = await getProductAccount(s.companyId, s.productId);
    expect(account.totalQuantity).toBe(0n);
    expect(account.lowLocations).toEqual([]);
  });

  it('rapporte les derniers mouvements, du plus recent au plus ancien', async () => {
    const s = await setup();
    await recordExit(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 3_000n, reason: 'Casse' },
    );

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.movements).toHaveLength(2);
    expect(account.movements[0]?.kind).toBe('OUT');
    expect(account.movements[0]?.quantity).toBe(-3_000n);
    expect(account.movements[0]?.quantityAfter).toBe(97_000n);
    expect(account.movements[0]?.reason).toBe('Casse');
    expect(account.movements[1]?.kind).toBe('IN');
  });
});

describe('ventes et marge', () => {
  it('ne compte rien tant que rien n a ete vendu', async () => {
    const s = await setup();
    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.soldQuantity).toBe(0n);
    expect(account.soldRevenue).toBe(0n);
    expect(account.margin).toBe(0n);
    expect(account.marginPercent).toBeNull();
    expect(account.lastSaleAt).toBeNull();
  });

  it('agrege les quantites vendues, le revenu et la marge', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, invoice.id);

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.soldQuantity).toBe(10_000n);
    expect(account.soldRevenue).toBe(150_000n); // 10 x 15 000
    expect(account.soldCost).toBe(120_000n); // 10 x 12 000
    expect(account.margin).toBe(30_000n);
    expect(account.marginPercent).toBe(20);
    expect(account.invoiceCount).toBe(1);
    expect(account.lastSaleAt).not.toBeNull();
  });

  /**
   * Le cas qui justifie le cout fige : le prix d'achat change apres la vente.
   * La marge historique ne doit pas bouger, sans quoi le rapport du mois
   * dernier se reecrirait tout seul.
   */
  it("garde la marge historique quand le prix d'achat change ensuite", async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, invoice.id);

    await updateProduct(s.companyId, s.productId, { ...productInput, costPrice: 14_000n });

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.soldCost).toBe(120_000n);
    expect(account.margin).toBe(30_000n);
  });

  it('exclut les brouillons et les factures annulees', async () => {
    const s = await setup();

    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });

    const cancelled = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    await issueInvoice(s.ctx, cancelled.id);
    await cancelInvoice(s.ctx, cancelled.id, 'Erreur de saisie');

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.soldQuantity).toBe(0n);
    expect(account.soldRevenue).toBe(0n);
    expect(account.invoiceCount).toBe(0);
  });

  it('ignore les ventes anterieures a la fenetre d analyse', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, invoice.id);

    // La meme fiche, lue comme si nous etions un an plus tard.
    const later = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const account = await getProductAccount(s.companyId, s.productId, later);

    expect(account.soldQuantity).toBe(0n);
    // La derniere vente reste connue : elle n'est pas bornee par la fenetre.
    expect(account.lastSaleAt).not.toBeNull();
  });

  it('compte une seule fois une facture portant deux lignes du meme article', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [
        { productId: s.productId, quantity: 3_000n },
        { productId: s.productId, quantity: 2_000n },
      ],
    });
    await issueInvoice(s.ctx, invoice.id);

    const account = await getProductAccount(s.companyId, s.productId);

    expect(account.soldQuantity).toBe(5_000n);
    expect(account.invoiceCount).toBe(1);
  });
});

describe('services', () => {
  it("n'attribue ni stock ni rupture a un service", async () => {
    const company = await createTestCompany();
    const service = await createProduct(company.companyId, {
      ...productInput,
      kind: 'SERVICE',
      name: 'Livraison a domicile',
      minStock: 10_000n,
    });

    const account = await getProductAccount(company.companyId, service.id);

    expect(account.product.trackStock).toBe(false);
    expect(account.levels).toEqual([]);
    expect(account.totalQuantity).toBe(0n);
    expect(account.lowLocations).toEqual([]);
  });
});

describe('isolation', () => {
  it("refuse l'article d'une autre entreprise", async () => {
    const s = await setup();
    const other = await createTestCompany({ email: 'autre@test.local' });

    await expect(getProductAccount(other.companyId, s.productId)).rejects.toThrow(NotFoundError);
  });

  it("ne compte pas les ventes d'une autre entreprise", async () => {
    const s = await setup();
    const other = await createTestCompany({ email: 'autre@test.local' });
    const otherCtx = await serviceContext(other.companyId, other.userId);
    const otherProduct = await createProduct(other.companyId, productInput);
    const otherCustomer = await createPartner(other.companyId, 'CUSTOMER', customerInput);

    await recordEntry(
      { companyId: other.companyId, userId: other.userId },
      { productId: otherProduct.id, locationId: other.locationId, quantity: 50_000n },
    );
    const invoice = await createInvoice(otherCtx, {
      customerId: otherCustomer.id,
      locationId: other.locationId,
      lines: [{ productId: otherProduct.id, quantity: 5_000n }],
    });
    await issueInvoice(otherCtx, invoice.id);

    const account = await getProductAccount(s.companyId, s.productId);
    expect(account.soldQuantity).toBe(0n);
    expect(account.totalQuantity).toBe(100_000n);
  });
});
