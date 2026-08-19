import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { getPartnerAccount } from '@/server/services/partner-account';
import { cancelInvoice, createInvoice, issueInvoice } from '@/server/services/invoices';
import { createPurchaseOrder, placeOrder } from '@/server/services/purchases';
import { recordPayment } from '@/server/services/payments';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recordEntry } from '@/server/services/stock';
import { NotFoundError } from '@/server/errors';
import { createTestCompany, paymentMethodId, resetDatabase, serviceContext } from '../helpers';

/**
 * Releve de compte d'un partenaire.
 *
 * Ce que ces tests protegent : le chiffre affiche au dirigeant sous « ce client
 * vous doit ». S'il est faux, il reclame de l'argent deja recu, ou laisse
 * filer une creance. Aucun de ces montants n'est stocke — ils sont tous
 * agreges a la lecture — donc chaque scenario verifie l'agregation elle-meme.
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

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);
  const customer = await createPartner(company.companyId, 'CUSTOMER', partnerInput);
  const supplier = await createPartner(company.companyId, 'SUPPLIER', {
    ...partnerInput,
    name: 'Grossiste Adjame',
    creditLimit: 0n,
  });

  await recordEntry(
    { companyId: company.companyId, userId: company.userId },
    { productId: product.id, locationId: company.locationId, quantity: 1_000_000n },
  );

  return {
    ...company,
    ctx,
    productId: product.id,
    customerId: customer.id,
    supplierId: supplier.id,
    cashId: await paymentMethodId(company.companyId, 'CASH'),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('compte client', () => {
  it('part de zero pour un client sans historique', async () => {
    const s = await setup();
    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.billed).toBe(0n);
    expect(account.outstanding).toBe(0n);
    expect(account.netOutstanding).toBe(0n);
    expect(account.documentCount).toBe(0);
    expect(account.documents).toEqual([]);
    expect(account.firstDocumentAt).toBeNull();
  });

  it('additionne les factures emises et le reste a encaisser', async () => {
    const s = await setup();
    const first = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, first.id);

    const second = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    await issueInvoice(s.ctx, second.id);

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 100_000n,
      invoiceId: first.id,
      methodId: s.cashId,
    });

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.billed).toBe(210_000n); // 150 000 + 60 000
    expect(account.settled).toBe(100_000n);
    expect(account.outstanding).toBe(110_000n);
    expect(account.netOutstanding).toBe(110_000n);
    expect(account.documentCount).toBe(2);
    expect(account.payments).toHaveLength(1);
  });

  /**
   * Une facture en brouillon n'a jamais ete remise au client : la compter
   * reviendrait a lui reclamer une somme dont il n'a jamais entendu parler.
   * Une facture annulee, elle, a rendu le stock ; elle ne doit plus rien.
   */
  it('ignore les brouillons et les factures annulees', async () => {
    const s = await setup();

    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const cancelled = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });
    await issueInvoice(s.ctx, cancelled.id);
    await cancelInvoice(s.ctx, cancelled.id, 'Client retracte');

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.documentCount).toBe(0);
    expect(account.billed).toBe(0n);
    expect(account.outstanding).toBe(0n);
  });

  /**
   * Un acompte encaisse avant toute facture est de l'argent deja recu : il
   * reduit ce que le client doit reellement, sinon on lui reclame deux fois.
   */
  it('deduit les acomptes non affectes de l encours net', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, invoice.id);

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 40_000n,
      partnerId: s.customerId,
      methodId: s.cashId,
    });

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.outstanding).toBe(150_000n);
    expect(account.unallocated).toBe(40_000n);
    expect(account.netOutstanding).toBe(110_000n);
  });

  it('ne rend jamais un encours net negatif', async () => {
    const s = await setup();
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 90_000n,
      partnerId: s.customerId,
      methodId: s.cashId,
    });

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);
    expect(account.netOutstanding).toBe(0n);
  });

  it('compte les echeances depassees, et seulement celles qui restent dues', async () => {
    const s = await setup();
    const overdue = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, overdue.id);

    const settled = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });
    await issueInvoice(s.ctx, settled.id);
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 30_000n,
      invoiceId: settled.id,
      methodId: s.cashId,
    });

    // Les deux echeances sont depassees ; une seule est encore due.
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.invoice.updateMany({
      where: { id: { in: [overdue.id, settled.id] } },
      data: { dueDate: past },
    });

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.overdueCount).toBe(1);
    expect(account.overdueAmount).toBe(150_000n);
  });

  it('rapporte la consommation du plafond de credit', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await issueInvoice(s.ctx, invoice.id);

    // 150 000 dus sur un plafond de 500 000.
    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);
    expect(account.creditUsagePercent).toBe(30);
  });

  it('ne rapporte aucun taux quand aucun credit n est autorise', async () => {
    const s = await setup();
    const account = await getPartnerAccount(s.companyId, 'SUPPLIER', s.supplierId);
    expect(account.creditUsagePercent).toBeNull();
  });

  /**
   * Les totaux sont agreges en base, la liste est plafonnee a cinquante
   * documents. Un releve dont le total ne porterait que sur la page affichee
   * serait faux sans en avoir l'air.
   */
  it('totalise tout l historique meme lorsque la liste est tronquee', async () => {
    const s = await setup();

    for (let index = 0; index < 52; index += 1) {
      const invoice = await createInvoice(s.ctx, {
        customerId: s.customerId,
        locationId: s.locationId,
        lines: [{ productId: s.productId, quantity: 1_000n }],
      });
      await issueInvoice(s.ctx, invoice.id);
    }

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);

    expect(account.documents).toHaveLength(50);
    expect(account.documentsTruncated).toBe(true);
    expect(account.documentCount).toBe(52);
    expect(account.billed).toBe(52n * 15_000n);
    expect(account.outstanding).toBe(52n * 15_000n);
  });
});

describe('compte fournisseur', () => {
  it('additionne les commandes passees et la dette restante', async () => {
    const s = await setup();
    const order = await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });
    await placeOrder(s.ctx, order.id);

    await recordPayment(s.ctx, {
      direction: 'OUT',
      amount: 50_000n,
      orderId: order.id,
      methodId: s.cashId,
    });

    const account = await getPartnerAccount(s.companyId, 'SUPPLIER', s.supplierId);

    expect(account.billed).toBe(120_000n);
    expect(account.settled).toBe(50_000n);
    expect(account.outstanding).toBe(70_000n);
    expect(account.documentCount).toBe(1);
    expect(account.payments).toHaveLength(1);
    expect(account.payments[0]?.documentNumber).toBe(order.number);
  });

  it('ignore les commandes restees en brouillon', async () => {
    const s = await setup();
    await createPurchaseOrder(s.ctx, {
      supplierId: s.supplierId,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 10_000n, unitCost: 12_000n }],
    });

    const account = await getPartnerAccount(s.companyId, 'SUPPLIER', s.supplierId);
    expect(account.documentCount).toBe(0);
    expect(account.outstanding).toBe(0n);
  });
});

describe('isolation', () => {
  it("refuse le partenaire d'une autre entreprise", async () => {
    const s = await setup();
    const other = await createTestCompany({ email: 'autre@test.local' });

    await expect(
      getPartnerAccount(other.companyId, 'CUSTOMER', s.customerId),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuse de lire un client comme un fournisseur', async () => {
    const s = await setup();
    await expect(getPartnerAccount(s.companyId, 'SUPPLIER', s.customerId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("ne melange pas les documents de deux entreprises portant le meme client", async () => {
    const s = await setup();
    const other = await createTestCompany({ email: 'autre@test.local' });
    const otherCtx = await serviceContext(other.companyId, other.userId);
    const otherProduct = await createProduct(other.companyId, productInput);
    const otherCustomer = await createPartner(other.companyId, 'CUSTOMER', partnerInput);

    await recordEntry(
      { companyId: other.companyId, userId: other.userId },
      { productId: otherProduct.id, locationId: other.locationId, quantity: 100_000n },
    );

    const invoice = await createInvoice(otherCtx, {
      customerId: otherCustomer.id,
      locationId: other.locationId,
      lines: [{ productId: otherProduct.id, quantity: 5_000n }],
    });
    await issueInvoice(otherCtx, invoice.id);

    const account = await getPartnerAccount(s.companyId, 'CUSTOMER', s.customerId);
    expect(account.documentCount).toBe(0);
    expect(account.billed).toBe(0n);
  });
});
