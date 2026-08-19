import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  isOverdue,
  issueInvoice,
  listInvoices,
} from '@/server/services/invoices';
import { recordPayment, deletePayment, partnerBalance } from '@/server/services/payments';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { createTaxRate } from '@/server/services/commerce-setup';
import { recordEntry } from '@/server/services/stock';
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

  return {
    ...company,
    ctx,
    productId: product.id,
    customerId: customer.id,
    cashId: await paymentMethodId(company.companyId, 'CASH'),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('createInvoice', () => {
  it('numerote, calcule et enregistre les lignes', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    expect(invoice.number).toMatch(/^FAC-\d{4}-00001$/);
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.total).toBe(45_000n);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]?.unitPrice).toBe(15_000n);
    // Le prix d'achat est fige a l'emission pour que la marge historique ne
    // bouge pas quand le catalogue change.
    expect(invoice.lines[0]?.unitCost).toBe(12_000n);
    expect(invoice.costTotal).toBe(36_000n);
  });

  it('ne sort pas le stock tant que la facture est un brouillon', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);
  });

  it('sort le stock a l emission', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(97_000n);
  });

  it('refuse d emettre au-dela du stock disponible', async () => {
    const s = await setup();
    await expect(
      createInvoice(s.ctx, {
        locationId: s.locationId,
        issue: true,
        lines: [{ productId: s.productId, quantity: 500_000n }],
      }),
    ).rejects.toThrow(ValidationError);

    // Rien ne doit subsister : ni facture, ni mouvement.
    expect(await prisma.invoice.count()).toBe(0);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);
  });

  it('applique remises et taxes', async () => {
    const s = await setup();
    const tax = await createTaxRate(s.companyId, {
      name: 'TVA 18 %',
      rate: 1_800,
      isDefault: true,
      isActive: true,
    });

    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      discountRate: 1_000,
      lines: [{ productId: s.productId, quantity: 10_000n, taxRateId: tax.id }],
    });

    // 150 000 - 10 % = 135 000 ; + 18 % = 159 300.
    expect(invoice.subtotal).toBe(150_000n);
    expect(invoice.discountAmount).toBe(15_000n);
    expect(invoice.taxTotal).toBe(24_300n);
    expect(invoice.total).toBe(159_300n);
  });

  it('accepte une ligne libre sans article', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ description: 'Prestation de montage', quantity: 1_000n, unitPrice: 25_000n }],
    });
    expect(invoice.total).toBe(25_000n);
    expect(invoice.lines[0]?.productId).toBeNull();
  });

  it('refuse une facture sans ligne', async () => {
    const s = await setup();
    await expect(createInvoice(s.ctx, { locationId: s.locationId, lines: [] })).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuse l'article, le client ou le taux d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    await expect(
      createInvoice(alpha.ctx, {
        locationId: alpha.locationId,
        lines: [{ productId: beta.productId, quantity: 1_000n }],
      }),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createInvoice(alpha.ctx, {
        customerId: beta.customerId,
        locationId: alpha.locationId,
        lines: [{ productId: alpha.productId, quantity: 1_000n }],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('numerote sans doublon sous concurrence', async () => {
    const s = await setup();
    const invoices = await Promise.all(
      Array.from({ length: 10 }, () =>
        createInvoice(s.ctx, {
          locationId: s.locationId,
          lines: [{ productId: s.productId, quantity: 1_000n }],
        }),
      ),
    );
    expect(new Set(invoices.map((invoice) => invoice.number)).size).toBe(10);
  });
});

describe('issueInvoice', () => {
  it('emet un brouillon et sort le stock une seule fois', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });

    await issueInvoice(s.ctx, invoice.id);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(96_000n);

    // Une seconde emission sortirait le stock en double.
    await expect(issueInvoice(s.ctx, invoice.id)).rejects.toThrow(ConflictError);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(96_000n);
  });
});

describe('paiements et solde', () => {
  it('calcule le reste a payer apres plusieurs reglements partiels', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    expect(invoice.total).toBe(150_000n);

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 50_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });
    let current = await getInvoice(s.companyId, invoice.id);
    expect(current.paidAmount).toBe(50_000n);
    expect(current.balanceDue).toBe(100_000n);
    expect(current.status).toBe('PARTIALLY_PAID');

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 100_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });
    current = await getInvoice(s.companyId, invoice.id);
    expect(current.paidAmount).toBe(150_000n);
    expect(current.balanceDue).toBe(0n);
    expect(current.status).toBe('PAID');
  });

  it('refuse un paiement superieur au solde restant', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 99_000n,
        invoiceId: invoice.id,
        methodId: s.cashId,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('accepte une avance quand elle est confirmee', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 20_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
      allowOverpayment: true,
    });

    const current = await getInvoice(s.companyId, invoice.id);
    expect(current.paidAmount).toBe(20_000n);
    // Un trop-percu n'est pas une dette du client envers lui-meme.
    expect(current.balanceDue).toBe(0n);
    expect(current.status).toBe('PAID');
  });

  it('recalcule le solde a la suppression d un paiement', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });

    const payment = await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 150_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });
    expect((await getInvoice(s.companyId, invoice.id)).status).toBe('PAID');

    await deletePayment(s.ctx, payment.id, 'Cheque sans provision');

    const after = await getInvoice(s.companyId, invoice.id);
    expect(after.paidAmount).toBe(0n);
    expect(after.balanceDue).toBe(150_000n);
    expect(after.status).toBe('ISSUED');
  });

  it('refuse "Credit" comme mode de reglement', async () => {
    const s = await setup();
    const creditId = await paymentMethodId(s.companyId, 'CREDIT');
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 15_000n,
        invoiceId: invoice.id,
        methodId: creditId,
      }),
    ).rejects.toThrow(/pas encore paye/);
  });

  it('exige une reference pour les modes qui en demandent une', async () => {
    const s = await setup();
    const momoId = await paymentMethodId(s.companyId, 'MOBILE_MONEY');
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 15_000n,
        invoiceId: invoice.id,
        methodId: momoId,
      }),
    ).rejects.toThrow(/reference/);

    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 15_000n,
        invoiceId: invoice.id,
        methodId: momoId,
        reference: 'MP240819.1423.A45678',
      }),
    ).resolves.toBeDefined();
  });

  it('refuse un paiement sur une facture brouillon ou annulee', async () => {
    const s = await setup();
    const draft = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 1_000n,
        invoiceId: draft.id,
        methodId: s.cashId,
      }),
    ).rejects.toThrow(ConflictError);

    const issued = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await cancelInvoice(s.ctx, issued.id, 'Erreur de saisie');
    await expect(
      recordPayment(s.ctx, {
        direction: 'IN',
        amount: 1_000n,
        invoiceId: issued.id,
        methodId: s.cashId,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('invariant : solde = total - somme des paiements', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 7_000n }],
    });

    for (const amount of [13_333n, 7_777n, 41_111n, 2n]) {
      await recordPayment(s.ctx, {
        direction: 'IN',
        amount,
        invoiceId: invoice.id,
        methodId: s.cashId,
      });
    }

    const current = await getInvoice(s.companyId, invoice.id);
    const sumOfPayments = current.payments.reduce((sum, payment) => sum + payment.amount, 0n);
    expect(current.paidAmount).toBe(sumOfPayments);
    expect(current.balanceDue).toBe(current.total - sumOfPayments);
  });
});

describe('cancelInvoice', () => {
  it('rend le stock sorti', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 6_000n }],
    });
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(94_000n);

    await cancelInvoice(s.ctx, invoice.id, 'Client s est retracte');
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);

    const after = await getInvoice(s.companyId, invoice.id);
    expect(after.status).toBe('CANCELLED');
    expect(after.balanceDue).toBe(0n);
  });

  it('ne rend pas de stock pour un brouillon (il n en est jamais sorti)', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 6_000n }],
    });

    await cancelInvoice(s.ctx, invoice.id, 'Abandon');
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);
  });

  it('exige un motif et refuse la double annulation', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await expect(cancelInvoice(s.ctx, invoice.id, '  ')).rejects.toThrow(ValidationError);
    await cancelInvoice(s.ctx, invoice.id, 'Erreur');
    await expect(cancelInvoice(s.ctx, invoice.id, 'Encore')).rejects.toThrow(ConflictError);
  });

  it('conserve les paiements deja recus', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 30_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });

    await cancelInvoice(s.ctx, invoice.id, 'Marchandise defectueuse');

    // Rembourser est une decision commerciale, pas une consequence mecanique.
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
});

describe('creances', () => {
  it("calcule l'encours d'un client", async () => {
    const s = await setup();
    const first = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 20_000n,
      invoiceId: first.id,
      methodId: s.cashId,
    });

    const balance = await partnerBalance(s.companyId, s.customerId);
    expect(balance.invoiced).toBe(90_000n);
    expect(balance.paid).toBe(20_000n);
    expect(balance.outstanding).toBe(70_000n);
  });

  it('exclut les factures annulees et les brouillons', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    const issued = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    await cancelInvoice(s.ctx, issued.id, 'Erreur');

    expect((await partnerBalance(s.companyId, s.customerId)).outstanding).toBe(0n);
  });

  it('deduit les acomptes non affectes', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 25_000n,
      partnerId: s.customerId,
      methodId: s.cashId,
    });

    const balance = await partnerBalance(s.companyId, s.customerId);
    expect(balance.outstanding).toBe(60_000n);
    expect(balance.advances).toBe(25_000n);
    expect(balance.netOutstanding).toBe(35_000n);
  });
});

describe('listInvoices et retards', () => {
  it('filtre les impayees et totalise', async () => {
    const s = await setup();
    const paid = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 15_000n,
      invoiceId: paid.id,
      methodId: s.cashId,
    });
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const unpaid = await listInvoices(s.companyId, { page: 1, pageSize: 25, unpaidOnly: true });
    expect(unpaid.total).toBe(1);
    expect(unpaid.sums.balance).toBe(30_000n);
  });

  it('deduit le retard de la date, sans statut stocke', () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);

    expect(isOverdue({ status: 'ISSUED', dueDate: past, balanceDue: 100n })).toBe(true);
    expect(isOverdue({ status: 'ISSUED', dueDate: future, balanceDue: 100n })).toBe(false);
    expect(isOverdue({ status: 'PAID', dueDate: past, balanceDue: 0n })).toBe(false);
    expect(isOverdue({ status: 'CANCELLED', dueDate: past, balanceDue: 100n })).toBe(false);
    expect(isOverdue({ status: 'DRAFT', dueDate: past, balanceDue: 100n })).toBe(false);
  });

  it("n'expose pas les factures d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await createInvoice(beta.ctx, {
      locationId: beta.locationId,
      issue: true,
      lines: [{ productId: beta.productId, quantity: 1_000n }],
    });

    expect((await listInvoices(alpha.companyId, { page: 1, pageSize: 25 })).total).toBe(0);
  });
});
