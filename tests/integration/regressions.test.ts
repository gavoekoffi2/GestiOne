import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createLocation, deleteLocation } from '@/server/services/locations';
import { createPartner, deletePartner } from '@/server/services/partners';
import { createProduct } from '@/server/services/catalog';
import { recordEntry } from '@/server/services/stock';
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  issueInvoice,
} from '@/server/services/invoices';
import { changeQuoteStatus, convertQuoteToInvoice, createQuote } from '@/server/services/quotes';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  receiveOrder,
} from '@/server/services/purchases';
import { recordInventory } from '@/server/services/stock';
import { recomputeStockFromMovements } from '@/server/services/stock-query';
import { recordPayment } from '@/server/services/payments';
import { cashBalance } from '@/server/services/cash';
import { recordExpense } from '@/server/services/expenses';
import { paymentMethodId } from '../helpers';
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

/** Lance deux fois la meme operation en parallele, comme un double clic. */
async function twice<T>(operation: () => Promise<T>) {
  const results = await Promise.allSettled([operation(), operation()]);
  return results.filter((result) => result.status === 'fulfilled').length;
}

async function stockSetup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);
  await recordEntry(
    { companyId: company.companyId, userId: company.userId },
    { productId: product.id, locationId: company.locationId, quantity: 100_000n },
  );
  const stock = () =>
    recomputeStockFromMovements(company.companyId, product.id, company.locationId);
  return { ...company, ctx, productId: product.id, stock };
}

describe('double clic : chaque operation ne s applique qu une fois', () => {
  it('emettre une facture', async () => {
    const s = await stockSetup();
    const draft = await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    expect(await twice(() => issueInvoice(s.ctx, draft.id))).toBe(1);
    expect(await s.stock()).toBe(95_000n);
  });

  it('annuler une facture', async () => {
    const s = await stockSetup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    expect(await twice(() => cancelInvoice(s.ctx, invoice.id, 'Erreur'))).toBe(1);
    expect(await s.stock()).toBe(100_000n);
  });

  it('convertir un devis', async () => {
    const s = await stockSetup();
    const quote = await createQuote(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');
    expect(await twice(() => convertQuoteToInvoice(s.ctx, quote.id, { issue: true }))).toBe(1);
    expect(await prisma.invoice.count({ where: { companyId: s.companyId } })).toBe(1);
    expect(await s.stock()).toBe(95_000n);
  });

  it('un devis dont la conversion echoue reste convertible', async () => {
    const s = await stockSetup();
    const quote = await createQuote(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 500_000n }],
    });
    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');
    // Stock insuffisant : la facture n'est pas creee.
    await expect(convertQuoteToInvoice(s.ctx, quote.id, { issue: true })).rejects.toThrow();
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('ACCEPTED');
    expect(after.invoiceId).toBeNull();
  });

  it('receptionner une commande', async () => {
    const s = await stockSetup();
    const order = await createPurchaseOrder(s.ctx, {
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 1_000n }],
    });
    const lineId = order.lines[0]!.id;
    expect(
      await twice(() => receiveOrder(s.ctx, order.id, { lines: [{ lineId, quantity: 10_000n }] })),
    ).toBe(1);
    expect(await s.stock()).toBe(110_000n);
    const after = await getPurchaseOrder(s.companyId, order.id);
    expect(after.lines[0]!.receivedQuantity).toBe(10_000n);
  });

  it('annuler une commande receptionnee', async () => {
    const s = await stockSetup();
    const order = await createPurchaseOrder(s.ctx, {
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 1_000n }],
    });
    expect(await twice(() => cancelPurchaseOrder(s.ctx, order.id, 'Erreur'))).toBe(1);
    expect(await s.stock()).toBe(100_000n);
  });

  it('deux premieres entrees simultanees dans un nouveau depot', async () => {
    const s = await stockSetup();
    const depotB = await createLocation(s.companyId, depot);
    const entry = () =>
      recordEntry(
        { companyId: s.companyId, userId: s.userId },
        { productId: s.productId, locationId: depotB.id, quantity: 1_000n },
      );
    expect(await twice(entry)).toBe(2);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, depotB.id)).toBe(2_000n);
  });
});

describe('commande receptionnee dans deux depots puis annulee', () => {
  it('retire la marchandise de chaque depot, pas seulement du dernier', async () => {
    const s = await stockSetup();
    const depotB = await createLocation(s.companyId, depot);
    const order = await createPurchaseOrder(s.ctx, {
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 1_000n }],
    });
    const lineId = order.lines[0]!.id;
    await receiveOrder(s.ctx, order.id, { lines: [{ lineId, quantity: 4_000n }] });
    await receiveOrder(s.ctx, order.id, {
      locationId: depotB.id,
      lines: [{ lineId, quantity: 6_000n }],
    });

    await cancelPurchaseOrder(s.ctx, order.id, 'Lot defectueux');

    expect(await s.stock()).toBe(100_000n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, depotB.id)).toBe(0n);
  });
});

describe('inventaire', () => {
  it('fixe le stock a la quantite comptee', async () => {
    const s = await stockSetup();
    await recordInventory(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, countedQuantity: 42_000n, reason: 'Comptage' },
    );
    expect(await s.stock()).toBe(42_000n);
  });
});

describe('paiements et caisse', () => {
  it('des especes encaissees depuis une facture entrent dans la caisse de son point de vente', async () => {
    const s = await stockSetup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    // L'ecran de la facture n'envoie pas de point de vente.
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 30_000n,
      invoiceId: invoice.id,
      methodId: await paymentMethodId(s.companyId, 'CASH'),
    });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(30_000n);
  });

  it('un reglement fournisseur en especes sort de la caisse', async () => {
    const s = await stockSetup();
    const cashId = await paymentMethodId(s.companyId, 'CASH');
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    await recordPayment(s.ctx, { direction: 'IN', amount: 60_000n, invoiceId: invoice.id, methodId: cashId });

    const order = await createPurchaseOrder(s.ctx, {
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 2_000n }],
    });
    await recordPayment(s.ctx, { direction: 'OUT', amount: 20_000n, orderId: order.id, methodId: cashId });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(40_000n);
  });

  it('refuse un decaissement rattache a une facture client', async () => {
    const s = await stockSetup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await expect(
      recordPayment(s.ctx, {
        direction: 'OUT',
        amount: 15_000n,
        invoiceId: invoice.id,
        methodId: await paymentMethodId(s.companyId, 'CASH'),
      }),
    ).rejects.toThrow(/encaissement/);
    expect((await getInvoice(s.companyId, invoice.id)).status).toBe('ISSUED');
  });

  it('deux encaissements simultanes du solde ne depassent pas le du', async () => {
    const s = await stockSetup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    const cashId = await paymentMethodId(s.companyId, 'CASH');
    const ok = await twice(() =>
      recordPayment(s.ctx, { direction: 'IN', amount: 15_000n, invoiceId: invoice.id, methodId: cashId }),
    );
    expect(ok).toBe(1);
    expect((await getInvoice(s.companyId, invoice.id)).paidAmount).toBe(15_000n);
  });
});

describe('numerotation', () => {
  it('une depense ne cree plus de trou dans la numerotation des paiements', async () => {
    const s = await stockSetup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    const cashId = await paymentMethodId(s.companyId, 'CASH');
    const pay = () =>
      recordPayment(s.ctx, { direction: 'IN', amount: 10_000n, invoiceId: invoice.id, methodId: cashId });

    const first = await pay();
    const expense = await recordExpense(s.ctx, { amount: 1_000n, description: 'Transport' });
    const second = await pay();

    expect(first.number.endsWith('00001')).toBe(true);
    expect(second.number.endsWith('00002')).toBe(true);
    expect(expense.number).toMatch(/-DEP-\d{4}-00001$/);
  });
});
