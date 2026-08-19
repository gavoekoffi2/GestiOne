import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectedSummary,
  dashboardData,
  expenseSummary,
  outstandingSummary,
  previousPeriod,
  resolvePeriod,
  revenueByPaymentMethod,
  revenueSeries,
  salesSummary,
  topCustomers,
  topProducts,
  variation,
} from '@/server/services/reports';
import { cancelInvoice, createInvoice } from '@/server/services/invoices';
import { recordPayment } from '@/server/services/payments';
import { recordExpense } from '@/server/services/expenses';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recordEntry } from '@/server/services/stock';
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
  creditLimit: 900_000n,
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
    { productId: product.id, locationId: company.locationId, quantity: 1_000_000n },
  );

  return {
    ...company,
    ctx,
    productId: product.id,
    customerId: customer.id,
    cashId: await paymentMethodId(company.companyId, 'CASH'),
    momoId: await paymentMethodId(company.companyId, 'MOBILE_MONEY'),
  };
}

const wholeYear = () => ({
  from: new Date(new Date().getFullYear(), 0, 1),
  to: new Date(new Date().getFullYear(), 11, 31, 23, 59, 59),
});

beforeEach(async () => {
  await resetDatabase();
});

describe('resolvePeriod', () => {
  const reference = new Date(2026, 7, 19, 14, 30); // mercredi 19 aout 2026

  it("borne aujourd'hui", () => {
    const period = resolvePeriod('today', reference);
    expect(period.from.getDate()).toBe(19);
    expect(period.from.getHours()).toBe(0);
    expect(period.to.getHours()).toBe(23);
  });

  it('fait commencer la semaine le lundi', () => {
    const period = resolvePeriod('week', reference);
    // Le 19 aout 2026 est un mercredi : la semaine commence le lundi 17.
    expect(period.from.getDate()).toBe(17);
    expect(period.from.getDay()).toBe(1);
  });

  it('gere le dimanche sans revenir a la semaine suivante', () => {
    const sunday = new Date(2026, 7, 23);
    const period = resolvePeriod('week', sunday);
    expect(period.from.getDate()).toBe(17);
  });

  it('borne le mois, le trimestre et l annee', () => {
    expect(resolvePeriod('month', reference).from.getMonth()).toBe(7);
    expect(resolvePeriod('month', reference).from.getDate()).toBe(1);
    // Aout appartient au trimestre juillet-septembre.
    expect(resolvePeriod('quarter', reference).from.getMonth()).toBe(6);
    expect(resolvePeriod('year', reference).from.getMonth()).toBe(0);
  });

  it('accepte une periode personnalisee', () => {
    const period = resolvePeriod('custom', reference, {
      from: new Date(2026, 0, 15),
      to: new Date(2026, 1, 20),
    });
    expect(period.from.getMonth()).toBe(0);
    expect(period.to.getMonth()).toBe(1);
    expect(period.to.getHours()).toBe(23);
  });
});

describe('previousPeriod', () => {
  it('rend une periode de meme duree, juste avant', () => {
    const period = { from: new Date(2026, 7, 1), to: new Date(2026, 7, 31, 23, 59, 59, 999) };
    const previous = previousPeriod(period);

    expect(previous.to.getTime()).toBeLessThan(period.from.getTime());
    const span = period.to.getTime() - period.from.getTime();
    const previousSpan = previous.to.getTime() - previous.from.getTime();
    expect(Math.abs(span - previousSpan)).toBeLessThanOrEqual(1);
  });
});

describe('salesSummary', () => {
  it('additionne le chiffre d affaires et calcule la marge brute', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });

    const summary = await salesSummary(s.companyId, wholeYear());
    // 10 x 15 000 = 150 000 ; cout 10 x 12 000 = 120 000 ; marge 30 000.
    expect(summary.revenue).toBe(150_000n);
    expect(summary.cost).toBe(120_000n);
    expect(summary.grossProfit).toBe(30_000n);
    expect(summary.invoiceCount).toBe(1);
    expect(summary.averageTicket).toBe(150_000n);
  });

  it('exclut les brouillons et les factures annulees', async () => {
    const s = await setup();
    // Brouillon : pas encore une vente.
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    const cancelled = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });
    await cancelInvoice(s.ctx, cancelled.id, 'Erreur');
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const summary = await salesSummary(s.companyId, wholeYear());
    expect(summary.revenue).toBe(30_000n);
    expect(summary.invoiceCount).toBe(1);
  });

  it('respecte les bornes de la periode', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      issueDate: new Date(2020, 0, 15),
      lines: [{ productId: s.productId, quantity: 5_000n }],
    });

    const thisYear = await salesSummary(s.companyId, wholeYear());
    expect(thisYear.revenue).toBe(0n);

    const old = await salesSummary(s.companyId, {
      from: new Date(2020, 0, 1),
      to: new Date(2020, 11, 31),
    });
    expect(old.revenue).toBe(75_000n);
  });

  it("n'expose pas le chiffre d'affaires d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await createInvoice(beta.ctx, {
      locationId: beta.locationId,
      issue: true,
      lines: [{ productId: beta.productId, quantity: 10_000n }],
    });

    expect((await salesSummary(alpha.companyId, wholeYear())).revenue).toBe(0n);
  });
});

describe('encaissements, depenses et resultat', () => {
  it('distingue facture et encaissement', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 60_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });

    const period = wholeYear();
    // 150 000 factures, mais seulement 60 000 reellement encaisses.
    expect((await salesSummary(s.companyId, period)).revenue).toBe(150_000n);
    expect((await collectedSummary(s.companyId, period)).collected).toBe(60_000n);
  });

  it('calcule le resultat net estime', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await recordExpense(s.ctx, { amount: 20_000n, description: 'Loyer' });

    const data = await dashboardData(s.companyId, wholeYear(), 'month');
    // Marge brute 30 000 - depenses 20 000 = 10 000.
    expect(data.sales.grossProfit).toBe(30_000n);
    expect(data.expenses.total).toBe(20_000n);
    expect(data.netResult).toBe(10_000n);
  });

  it('rend un resultat negatif quand les depenses depassent la marge', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await recordExpense(s.ctx, { amount: 500_000n, description: 'Loyer annuel' });

    const data = await dashboardData(s.companyId, wholeYear(), 'month');
    expect(data.netResult).toBe(3_000n - 500_000n);
    expect(data.netResult < 0n).toBe(true);
  });

  it('agrege les depenses de la periode', async () => {
    const s = await setup();
    await recordExpense(s.ctx, { amount: 5_000n, description: 'Taxi' });
    await recordExpense(s.ctx, { amount: 7_500n, description: 'Essence' });

    const summary = await expenseSummary(s.companyId, wholeYear());
    expect(summary.total).toBe(12_500n);
    expect(summary.count).toBe(2);
  });
});

describe('creances et dettes', () => {
  it('additionne ce qui reste du et signale les retards', async () => {
    const s = await setup();
    // Facture echue hier, non payee.
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() - 86_400_000),
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });
    // Facture a echeance future.
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() + 86_400_000 * 30),
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const outstanding = await outstandingSummary(s.companyId);
    expect(outstanding.receivable).toBe(90_000n);
    expect(outstanding.receivableCount).toBe(2);
    expect(outstanding.overdue).toBe(60_000n);
    expect(outstanding.overdueCount).toBe(1);
  });
});

describe('serie chronologique', () => {
  it('enumere tous les intervalles, y compris les jours sans activite', async () => {
    const s = await setup();
    const period = {
      from: new Date(2026, 5, 1),
      to: new Date(2026, 5, 5, 23, 59, 59),
    };

    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      issueDate: new Date(2026, 5, 3, 10),
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const series = await revenueSeries(s.companyId, period, 'day');
    expect(series).toHaveLength(5);
    // Un graphique qui sauterait les jours creux donnerait une fausse impression
    // de regularite.
    expect(series.map((point) => point.revenue)).toEqual([0n, 0n, 30_000n, 0n, 0n]);
  });

  it('agrege par mois', async () => {
    const s = await setup();
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      issueDate: new Date(2026, 0, 10),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      issueDate: new Date(2026, 0, 20),
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const series = await revenueSeries(
      s.companyId,
      { from: new Date(2026, 0, 1), to: new Date(2026, 1, 28) },
      'month',
    );
    expect(series[0]?.revenue).toBe(45_000n);
    expect(series[1]?.revenue).toBe(0n);
  });

  it('inclut les depenses dans la serie', async () => {
    const s = await setup();
    await recordExpense(s.ctx, {
      amount: 8_000n,
      description: 'Transport',
      spentAt: new Date(2026, 5, 2, 9),
    });

    const series = await revenueSeries(
      s.companyId,
      { from: new Date(2026, 5, 1), to: new Date(2026, 5, 3, 23, 59, 59) },
      'day',
    );
    expect(series[1]?.expenses).toBe(8_000n);
  });
});

describe('classements', () => {
  it('classe les produits par chiffre d affaires et calcule leur marge', async () => {
    const s = await setup();
    const second = await createProduct(s.companyId, {
      ...productInput,
      name: 'Huile 5 L',
      salePrice: 6_500n,
      costPrice: 5_000n,
    });
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: second.id, locationId: s.locationId, quantity: 100_000n },
    );

    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [
        { productId: s.productId, quantity: 10_000n },
        { productId: second.id, quantity: 4_000n },
      ],
    });

    const ranking = await topProducts(s.companyId, wholeYear());
    expect(ranking[0]?.name).toBe('Sac de riz 25 kg');
    expect(ranking[0]?.revenue).toBe(150_000n);
    expect(ranking[0]?.quantity).toBe(10_000n);
    expect(ranking[0]?.profit).toBe(30_000n);
    expect(ranking[1]?.name).toBe('Huile 5 L');
    expect(ranking[1]?.revenue).toBe(26_000n);
    expect(ranking[1]?.profit).toBe(6_000n);
  });

  it('exclut les factures annulees du classement produits', async () => {
    const s = await setup();
    const cancelled = await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 50_000n }],
    });
    await cancelInvoice(s.ctx, cancelled.id, 'Erreur');

    expect(await topProducts(s.companyId, wholeYear())).toHaveLength(0);
  });

  it('classe les clients et rappelle leur encours', async () => {
    const s = await setup();
    const other = await createPartner(s.companyId, 'CUSTOMER', {
      ...customerInput,
      name: 'Yao Kouassi',
    });

    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });
    await createInvoice(s.ctx, {
      customerId: other.id,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });

    const ranking = await topCustomers(s.companyId, wholeYear());
    expect(ranking[0]?.name).toBe('Ama Diallo');
    expect(ranking[0]?.revenue).toBe(150_000n);
    expect(ranking[0]?.outstanding).toBe(150_000n);
    expect(ranking[1]?.name).toBe('Yao Kouassi');
  });

  it('repartit le chiffre d affaires par mode de reglement', async () => {
    const s = await setup();
    const invoice = await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 10_000n }],
    });

    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 100_000n,
      invoiceId: invoice.id,
      methodId: s.cashId,
    });
    await recordPayment(s.ctx, {
      direction: 'IN',
      amount: 50_000n,
      invoiceId: invoice.id,
      methodId: s.momoId,
      reference: 'MP-1',
    });

    const breakdown = await revenueByPaymentMethod(s.companyId, wholeYear());
    expect(breakdown[0]?.name).toBe('Especes');
    expect(breakdown[0]?.total).toBe(100_000n);
    expect(breakdown[1]?.name).toBe('Mobile Money');
    expect(breakdown[1]?.total).toBe(50_000n);
  });
});

describe('variation', () => {
  it('calcule un pourcentage de progression', () => {
    expect(variation(150n, 100n)).toBe(50);
    expect(variation(50n, 100n)).toBe(-50);
    expect(variation(100n, 100n)).toBe(0);
  });

  it('rend null quand la base est nulle (pas de progression infinie)', () => {
    expect(variation(100n, 0n)).toBeNull();
  });
});

describe('dashboardData', () => {
  it('compare la periode a la precedente', async () => {
    const s = await setup();
    const thisMonth = resolvePeriod('month');
    const lastMonth = previousPeriod(thisMonth);

    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      issueDate: new Date(lastMonth.from.getTime() + 3_600_000),
      lines: [{ productId: s.productId, quantity: 2_000n }],
    });
    await createInvoice(s.ctx, {
      locationId: s.locationId,
      issue: true,
      lines: [{ productId: s.productId, quantity: 4_000n }],
    });

    const data = await dashboardData(s.companyId, thisMonth, 'day');
    expect(data.sales.revenue).toBe(60_000n);
    expect(data.previousSales.revenue).toBe(30_000n);
    expect(variation(data.sales.revenue, data.previousSales.revenue)).toBe(100);
  });

  it('rend des zeros coherents sur une entreprise sans activite', async () => {
    const s = await setup();
    const data = await dashboardData(s.companyId, resolvePeriod('month'), 'day');

    expect(data.sales.revenue).toBe(0n);
    expect(data.sales.averageTicket).toBe(0n);
    expect(data.netResult).toBe(0n);
    expect(data.topProducts).toHaveLength(0);
    expect(data.series.every((point) => point.revenue === 0n)).toBe(true);
  });
});
