import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  changeQuoteStatus,
  convertQuoteToInvoice,
  createQuote,
  getQuote,
  isExpired,
  listQuotes,
} from '@/server/services/quotes';
import { recordSale } from '@/server/services/sales';
import { getInvoice } from '@/server/services/invoices';
import { partnerBalance } from '@/server/services/payments';
import { createProduct } from '@/server/services/catalog';
import { createPartner, updatePartner } from '@/server/services/partners';
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
    creditId: await paymentMethodId(company.companyId, 'CREDIT'),
    momoId: await paymentMethodId(company.companyId, 'MOBILE_MONEY'),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('devis', () => {
  it('cree un devis sans toucher au stock ni creer de creance', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });

    expect(quote.number).toMatch(/^DEV-\d{4}-00001$/);
    expect(quote.status).toBe('DRAFT');
    expect(quote.total).toBe(75_000n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);
    expect((await partnerBalance(s.companyId, s.customerId)).outstanding).toBe(0n);
  });

  it('suit le cycle de vie autorise', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    await changeQuoteStatus(s.ctx, quote.id, 'SENT');
    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');
    expect((await getQuote(s.companyId, quote.id)).status).toBe('ACCEPTED');
  });

  it('refuse une transition incoherente', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    // Un brouillon n'a pas pu expirer : il n'a jamais ete envoye.
    await expect(changeQuoteStatus(s.ctx, quote.id, 'EXPIRED')).rejects.toThrow(ConflictError);
  });

  it('interdit de changer le statut via la conversion', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await expect(changeQuoteStatus(s.ctx, quote.id, 'CONVERTED')).rejects.toThrow(ValidationError);
  });

  it('deduit l expiration de la date de validite', () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);

    expect(isExpired({ status: 'SENT', validUntil: past })).toBe(true);
    expect(isExpired({ status: 'SENT', validUntil: future })).toBe(false);
    expect(isExpired({ status: 'ACCEPTED', validUntil: past })).toBe(false);
    expect(isExpired({ status: 'SENT', validUntil: null })).toBe(false);
  });

  it("n'expose pas les devis d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    const betaQuote = await createQuote(beta.ctx, {
      customerId: beta.customerId,
      lines: [{ productId: beta.productId, quantity: 1_000n }],
    });

    expect((await listQuotes(alpha.companyId, { page: 1, pageSize: 25 })).total).toBe(0);
    await expect(getQuote(alpha.companyId, betaQuote.id)).rejects.toThrow(NotFoundError);
  });
});

describe('conversion devis vers facture', () => {
  it('reprend lignes, prix et remise, et sort le stock a l emission', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      discountAmount: 5_000n,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await changeQuoteStatus(s.ctx, quote.id, 'SENT');
    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');

    const invoice = await convertQuoteToInvoice(s.ctx, quote.id, { issue: true });

    expect(invoice.total).toBe(quote.total);
    expect(invoice.lines).toHaveLength(1);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(90_000n);

    const converted = await getQuote(s.companyId, quote.id);
    expect(converted.status).toBe('CONVERTED');
    expect(converted.invoiceId).toBe(invoice.id);
  });

  it('conserve le prix accepte meme si le catalogue a change', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });
    expect(quote.total).toBe(30_000n);

    // Le prix du catalogue augmente apres l'envoi du devis.
    await prisma.product.update({ where: { id: s.productId }, data: { salePrice: 20_000n } });

    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');
    const invoice = await convertQuoteToInvoice(s.ctx, quote.id);

    // Le client doit etre facture au prix qu'il a accepte.
    expect(invoice.total).toBe(30_000n);
  });

  it('refuse une seconde conversion', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });
    await changeQuoteStatus(s.ctx, quote.id, 'ACCEPTED');
    await convertQuoteToInvoice(s.ctx, quote.id, { issue: true });

    await expect(convertQuoteToInvoice(s.ctx, quote.id, { issue: true })).rejects.toThrow(
      ConflictError,
    );

    // Le stock n'a bouge qu'une fois, et une seule facture existe.
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(97_000n);
    expect(await prisma.invoice.count()).toBe(1);
  });

  it('refuse de convertir un devis refuse', async () => {
    const s = await setup();
    const quote = await createQuote(s.ctx, {
      customerId: s.customerId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await changeQuoteStatus(s.ctx, quote.id, 'REJECTED');

    await expect(convertQuoteToInvoice(s.ctx, quote.id)).rejects.toThrow(ConflictError);
  });
});

describe('vente au comptoir', () => {
  it('encaisse en especes, solde la facture et sort le stock', async () => {
    const s = await setup();
    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
      payment: { methodId: s.cashId },
    });

    expect(sale.total).toBe(30_000n);
    expect(sale.paid).toBe(30_000n);
    expect(sale.balanceDue).toBe(0n);
    expect(sale.changeDue).toBe(0n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(98_000n);

    const invoice = await getInvoice(s.companyId, sale.invoiceId);
    expect(invoice.origin).toBe('POS');
    expect(invoice.status).toBe('PAID');
  });

  it('calcule la monnaie a rendre sans creer de trop-percu', async () => {
    const s = await setup();
    // Total 30 000, le client tend un billet de 50 000.
    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
      payment: { methodId: s.cashId, amount: 50_000n },
    });

    expect(sale.changeDue).toBe(20_000n);
    expect(sale.paid).toBe(30_000n);

    // Seul le du est enregistre : la caisse ne doit pas croire avoir encaisse 50 000.
    const invoice = await getInvoice(s.companyId, sale.invoiceId);
    expect(invoice.payments[0]?.amount).toBe(30_000n);
  });

  it('accepte un reglement partiel et laisse le reste en creance', async () => {
    const s = await setup();
    const sale = await recordSale(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 4_000n }],
      payment: { methodId: s.cashId, amount: 20_000n },
    });

    expect(sale.total).toBe(60_000n);
    expect(sale.paid).toBe(20_000n);
    expect(sale.balanceDue).toBe(40_000n);
    expect((await partnerBalance(s.companyId, s.customerId)).outstanding).toBe(40_000n);
  });

  it('enregistre une vente a credit comme creance', async () => {
    const s = await setup();
    const sale = await recordSale(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    expect(sale.paid).toBe(0n);
    expect(sale.balanceDue).toBe(45_000n);
    expect(sale.paymentId).toBeNull();

    const invoice = await getInvoice(s.companyId, sale.invoiceId);
    expect(invoice.status).toBe('ISSUED');
    // Le stock sort quand meme : la marchandise est partie.
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(97_000n);
  });

  it("traite le mode Credit comme une absence de paiement", async () => {
    const s = await setup();
    const sale = await recordSale(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 1_000n }],
      payment: { methodId: s.creditId },
    });

    expect(sale.paid).toBe(0n);
    expect(sale.balanceDue).toBe(15_000n);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('refuse une vente a credit sans client identifie', async () => {
    const s = await setup();
    await expect(
      recordSale(s.ctx, {
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 1_000n }],
      }),
    ).rejects.toThrow(/client/);

    expect(await prisma.invoice.count()).toBe(0);
  });

  it("refuse le credit a un client sans plafond d'encours", async () => {
    const s = await setup();
    await updatePartner(s.companyId, 'CUSTOMER', s.customerId, {
      ...customerInput,
      creditLimit: 0n,
    });

    await expect(
      recordSale(s.ctx, {
        customerId: s.customerId,
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 1_000n }],
      }),
    ).rejects.toThrow(/plafond/);
  });

  it("refuse le credit une fois le plafond d'encours atteint", async () => {
    const s = await setup();
    await updatePartner(s.companyId, 'CUSTOMER', s.customerId, {
      ...customerInput,
      creditLimit: 40_000n,
    });

    // Premiere vente a credit : 45 000, au-dela du plafond mais autorisee car
    // l'encours etait nul au moment de la vente.
    await recordSale(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    await expect(
      recordSale(s.ctx, {
        customerId: s.customerId,
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 1_000n }],
      }),
    ).rejects.toThrow(/plafond/);
  });

  it('exige une reference pour un reglement Mobile Money', async () => {
    const s = await setup();
    await expect(
      recordSale(s.ctx, {
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 1_000n }],
        payment: { methodId: s.momoId },
      }),
    ).rejects.toThrow(/reference/);
  });

  it('refuse de vendre au-dela du stock disponible', async () => {
    const s = await setup();
    await expect(
      recordSale(s.ctx, {
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 500_000n }],
        payment: { methodId: s.cashId },
      }),
    ).rejects.toThrow(ValidationError);

    expect(await prisma.invoice.count()).toBe(0);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(100_000n);
  });

  it("refuse le point de vente d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    await expect(
      recordSale(alpha.ctx, {
        locationId: beta.locationId,
        lines: [{ productId: alpha.productId, quantity: 1_000n }],
        payment: { methodId: alpha.cashId },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('vend un service sans mouvement de stock', async () => {
    const s = await setup();
    const service = await createProduct(s.companyId, {
      ...productInput,
      kind: 'SERVICE',
      name: 'Livraison Abidjan',
      salePrice: 2_500n,
    });

    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: service.id, quantity: 1_000n }],
      payment: { methodId: s.cashId },
    });

    expect(sale.total).toBe(2_500n);
    expect(await prisma.stockMovement.count({ where: { productId: service.id } })).toBe(0);
  });

  it('vend plusieurs articles en une seule operation', async () => {
    const s = await setup();
    const second = await createProduct(s.companyId, {
      ...productInput,
      name: 'Huile 5 L',
      salePrice: 6_500n,
      costPrice: 5_000n,
    });
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: second.id, locationId: s.locationId, quantity: 50_000n },
    );

    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [
        { productId: s.productId, quantity: 2_000n },
        { productId: second.id, quantity: 3_000n },
      ],
      payment: { methodId: s.cashId },
    });

    // 2 x 15 000 + 3 x 6 500 = 49 500.
    expect(sale.total).toBe(49_500n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.locationId)).toBe(98_000n);
    expect(await recomputeStockFromMovements(s.companyId, second.id, s.locationId)).toBe(47_000n);
  });

  it('applique une remise globale a la vente', async () => {
    const s = await setup();
    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
      discountRate: 500,
      payment: { methodId: s.cashId },
    });

    // 150 000 - 5 % = 142 500.
    expect(sale.total).toBe(142_500n);
    expect(sale.paid).toBe(142_500n);
  });

  it('reste coherent sous concurrence sur un stock limite', async () => {
    const s = await setup();
    const scarce = await createProduct(s.companyId, {
      ...productInput,
      name: 'Article rare',
      salePrice: 1_000n,
    });
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: scarce.id, locationId: s.locationId, quantity: 5_000n },
    );

    // Dix ventes simultanees d'une unite pour cinq disponibles.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        recordSale(s.ctx, {
          locationId: s.locationId,
          lines: [{ productId: scarce.id, quantity: 1_000n }],
          payment: { methodId: s.cashId },
        }),
      ),
    );

    const accepted = results.filter((result) => result.status === 'fulfilled').length;
    expect(accepted).toBe(5);
    expect(await recomputeStockFromMovements(s.companyId, scarce.id, s.locationId)).toBe(0n);

    // Autant de factures que de ventes reussies : aucune facture orpheline.
    expect(await prisma.invoice.count({ where: { origin: 'POS' } })).toBe(5);
  });
});
