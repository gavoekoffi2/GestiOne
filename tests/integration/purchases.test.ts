import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  payablesBySupplier,
  placeOrder,
  receiveOrder,
} from '@/server/services/purchases';
import { recordPayment, deletePayment } from '@/server/services/payments';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recomputeStockFromMovements } from '@/server/services/stock-query';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { createTestCompany, paymentMethodId, resetDatabase, serviceContext } from '../helpers';

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

const supplierInput = {
  name: 'Grossiste Adjame',
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
};

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);
  const supplier = await createPartner(company.companyId, 'SUPPLIER', supplierInput);

  return {
    ...company,
    ctx,
    productId: product.id,
    supplierId: supplier.id,
    cashId: await paymentMethodId(company.companyId, 'CASH'),
    transferId: await paymentMethodId(company.companyId, 'BANK_TRANSFER'),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('createPurchaseOrder', () => {
  it('cree un brouillon sans dette ni entree de stock', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });

    expect(order.number).toMatch(/^CMD-\d{4}-00001$/);
    expect(order.status).toBe('DRAFT');
    expect(order.total).toBe(120_000n);
    // Un brouillon n'engage rien : ni dette, ni marchandise.
    expect(order.balanceDue).toBe(0n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(0n);
  });

  it('rend la dette exigible a la commande', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });

    expect(order.status).toBe('ORDERED');
    expect(order.balanceDue).toBe(120_000n);
  });

  it('achat direct : commande et reception en une fois', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });

    expect(order.status).toBe('RECEIVED');
    expect(order.balanceDue).toBe(120_000n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(10_000n);
  });

  it('conserve le cout negocie du lot', async () => {
    const s = await setup();
    // Le catalogue dit 12 000, mais ce lot a ete negocie a 11 500.
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 11_500n }],
    });

    expect(order.total).toBe(115_000n);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: s.productId, kind: 'IN' },
    });
    expect(movement.unitCost).toBe(11_500n);
  });

  it('applique remises et taxes', async () => {
    const s = await setup();
    const tax = await prisma.taxRate.create({
      data: { companyId: s.companyId, name: 'TVA 18 %', rate: 1_800 },
    });

    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      discountRate: 1_000,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 10_000n, taxRateId: tax.id }],
    });

    // 100 000 - 10 % = 90 000 ; + 18 % = 106 200.
    expect(order.subtotal).toBe(100_000n);
    expect(order.discountAmount).toBe(10_000n);
    expect(order.total).toBe(106_200n);
  });

  it("refuse le fournisseur, l'article ou le point de vente d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    await expect(
      createPurchaseOrder(alpha.ctx, {
        supplierId: beta.supplierId,
        lines: [{ productId: alpha.productId, quantity: 1_000n, unitCost: 1n }],
      }),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createPurchaseOrder(alpha.ctx, {
        lines: [{ productId: beta.productId, quantity: 1_000n, unitCost: 1n }],
      }),
    ).rejects.toThrow(NotFoundError);

    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it('refuse un client comme fournisseur', async () => {
    const s = await setup();
    const customer = await createPartner(s.companyId, 'CUSTOMER', supplierInput);
    await expect(
      createPurchaseOrder(s.ctx, {
        supplierId: customer.id,
        lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 1n }],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('numerote sans doublon sous concurrence', async () => {
    const s = await setup();
    const orders = await Promise.all(
      Array.from({ length: 10 }, () =>
        createPurchaseOrder(s.ctx, {
          supplierId: s.supplierId,
          lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 1_000n }],
        }),
      ),
    );
    expect(new Set(orders.map((order) => order.number)).size).toBe(10);
  });
});

describe('reception', () => {
  it('receptionne partiellement puis totalement', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });
    const lineId = order.lines[0]!.id;

    await receiveOrder(s.ctx, order.id, { lines: [{ lineId, quantity: 4_000n }] });
    let current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.status).toBe('PARTIALLY_RECEIVED');
    expect(current.lines[0]?.receivedQuantity).toBe(4_000n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(4_000n);

    await receiveOrder(s.ctx, order.id, { lines: [{ lineId, quantity: 6_000n }] });
    current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.status).toBe('RECEIVED');
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(10_000n);
  });

  it('refuse de receptionner plus que commande', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 12_000n }],
    });

    await expect(
      receiveOrder(s.ctx, order.id, { lines: [{ lineId: order.lines[0]!.id, quantity: 6_000n }] }),
    ).rejects.toThrow(ValidationError);

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(0n);
  });

  it('refuse une reception vide', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 1n }],
    });
    await expect(receiveOrder(s.ctx, order.id, { lines: [] })).rejects.toThrow(ValidationError);
  });

  it('refuse de receptionner une commande deja recue ou annulee', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 1n }],
    });

    await expect(
      receiveOrder(s.ctx, order.id, { lines: [{ lineId: order.lines[0]!.id, quantity: 1_000n }] }),
    ).rejects.toThrow(ConflictError);
  });

  it('rend la dette exigible meme si la commande etait en brouillon', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 10_000n }],
    });
    expect(order.balanceDue).toBe(0n);

    await receiveOrder(s.ctx, order.id, { lines: [{ lineId: order.lines[0]!.id, quantity: 5_000n }] });

    // La marchandise est arrivee : elle sera a payer.
    const current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.balanceDue).toBe(50_000n);
  });
});

describe('reglement fournisseur', () => {
  it('reduit la dette et solde la commande', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });

    await recordPayment(s.ctx, {
      direction: 'OUT',
      amount: 50_000n,
      orderId: order.id,
      methodId: s.transferId,
      reference: 'VIR-001',
    });
    let current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.paidAmount).toBe(50_000n);
    expect(current.balanceDue).toBe(70_000n);

    await recordPayment(s.ctx, {
      direction: 'OUT',
      amount: 70_000n,
      orderId: order.id,
      methodId: s.transferId,
      reference: 'VIR-002',
    });
    current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.balanceDue).toBe(0n);
  });

  it('refuse un reglement superieur au solde', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 12_000n }],
    });

    await expect(
      recordPayment(s.ctx, {
        direction: 'OUT',
        amount: 99_000n,
        orderId: order.id,
        methodId: s.transferId,
        reference: 'VIR',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse de regler une commande en brouillon', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 12_000n }],
    });

    await expect(
      recordPayment(s.ctx, {
        direction: 'OUT',
        amount: 1_000n,
        orderId: order.id,
        methodId: s.transferId,
        reference: 'VIR',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('recalcule la dette a la suppression d un reglement', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 12_000n }],
    });

    const payment = await recordPayment(s.ctx, {
      direction: 'OUT',
      amount: 12_000n,
      orderId: order.id,
      methodId: s.transferId,
      reference: 'VIR',
    });
    expect((await getPurchaseOrder(s.companyId, order.id)).balanceDue).toBe(0n);

    await deletePayment(s.ctx, payment.id, 'Virement rejete');
    expect((await getPurchaseOrder(s.companyId, order.id)).balanceDue).toBe(12_000n);
  });
});

describe('annulation', () => {
  it('ressort du stock la marchandise deja recue', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 8_000n, unitCost: 12_000n }],
    });
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(8_000n);

    await cancelPurchaseOrder(s.ctx, order.id, 'Marchandise non conforme');

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(0n);
    const current = await getPurchaseOrder(s.companyId, order.id);
    expect(current.status).toBe('CANCELLED');
    expect(current.balanceDue).toBe(0n);
  });

  it('ne touche pas au stock pour une commande jamais recue', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 8_000n, unitCost: 12_000n }],
    });

    await cancelPurchaseOrder(s.ctx, order.id, 'Fournisseur en rupture');
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it('exige un motif et refuse la double annulation', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      order: true,
      lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 1n }],
    });

    await expect(cancelPurchaseOrder(s.ctx, order.id, '  ')).rejects.toThrow(ValidationError);
    await cancelPurchaseOrder(s.ctx, order.id, 'Erreur');
    await expect(cancelPurchaseOrder(s.ctx, order.id, 'Encore')).rejects.toThrow(ConflictError);
  });
});

describe('dettes fournisseur', () => {
  it('agrege par fournisseur et exclut brouillons et annulations', async () => {
    const s = await setup();
    await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      receiveNow: true,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 10_000n }],
    });
    // Brouillon : ne compte pas.
    await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 10_000n }],
    });
    const cancelled = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      order: true,
      lines: [{ productId: s.productId, quantity: 5_000n, unitCost: 10_000n }],
    });
    await cancelPurchaseOrder(s.ctx, cancelled.id, 'Erreur');

    const payables = await payablesBySupplier(s.companyId);
    expect(payables).toHaveLength(1);
    expect(payables[0]?.outstanding).toBe(50_000n);
    expect(payables[0]?.orderCount).toBe(1);
  });

  it("n'expose pas les commandes d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await createPurchaseOrder(beta.ctx, {
      supplierId: beta.supplierId,
      order: true,
      lines: [{ productId: beta.productId, quantity: 1_000n, unitCost: 1_000n }],
    });

    expect((await listPurchaseOrders(alpha.companyId, { page: 1, pageSize: 25 })).total).toBe(0);
    expect(await payablesBySupplier(alpha.companyId)).toHaveLength(0);
  });
});

describe('placeOrder', () => {
  it('passe un brouillon en commande', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      lines: [{ productId: s.productId, quantity: 1_000n, unitCost: 10_000n }],
    });

    const placed = await placeOrder(s.ctx, order.id);
    expect(placed.status).toBe('ORDERED');
    expect(placed.balanceDue).toBe(10_000n);

    await expect(placeOrder(s.ctx, order.id)).rejects.toThrow(ConflictError);
  });
});
