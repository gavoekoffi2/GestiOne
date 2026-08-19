import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { CHANNELS, collectAlerts } from '@/server/services/notifications';
import { createInvoice } from '@/server/services/invoices';
import { createQuote } from '@/server/services/quotes';
import { createProduct } from '@/server/services/catalog';
import { createPartner } from '@/server/services/partners';
import { recordEntry, recordExit } from '@/server/services/stock';
import { openCashSession } from '@/server/services/cash';
import { createTestCompany, resetDatabase, serviceContext } from '../helpers';

const ALL = ['*'];

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
  minStock: 5_000n,
  isActive: true,
};

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);
  const customer = await createPartner(company.companyId, 'CUSTOMER', {
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
  });
  return { ...company, ctx, productId: product.id, customerId: customer.id };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('alertes de stock', () => {
  it('signale une rupture', async () => {
    const s = await setup();
    const alerts = await collectAlerts(s.companyId, ALL);

    const out = alerts.find((alert) => alert.kind === 'STOCK_OUT');
    expect(out?.count).toBe(1);
    expect(out?.severity).toBe('critical');
  });

  it('signale un stock sous le seuil', async () => {
    const s = await setup();
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 4_000n },
    );

    const alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'STOCK_LOW')?.count).toBe(1);
    expect(alerts.find((alert) => alert.kind === 'STOCK_OUT')).toBeUndefined();
  });

  it("disparait d'elle-meme une fois le probleme resolu", async () => {
    const s = await setup();
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 50_000n },
    );

    // Aucune tache de nettoyage n'est necessaire : l'alerte est calculee.
    let alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.filter((alert) => alert.kind.startsWith('STOCK'))).toHaveLength(0);

    await recordExit(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 50_000n },
    );
    alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'STOCK_OUT')).toBeDefined();
  });

  it('ignore les services et les articles inactifs', async () => {
    const s = await setup();
    await prisma.product.update({ where: { id: s.productId }, data: { isActive: false } });
    await createProduct(s.companyId, { ...productInput, kind: 'SERVICE', name: 'Livraison' });

    const alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.filter((alert) => alert.kind.startsWith('STOCK'))).toHaveLength(0);
  });
});

describe('alertes commerciales', () => {
  it('signale les factures en retard, pas celles a venir', async () => {
    const s = await setup();
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 100_000n },
    );

    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() - 86_400_000),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() + 86_400_000 * 30),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    const alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'INVOICE_OVERDUE')?.count).toBe(1);
  });

  it('signale un devis proche de l expiration, pas un devis lointain', async () => {
    const s = await setup();
    await createQuote(s.ctx, {
      customerId: s.customerId,
      validUntil: new Date(Date.now() + 86_400_000),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });
    await createQuote(s.ctx, {
      customerId: s.customerId,
      validUntil: new Date(Date.now() + 86_400_000 * 30),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    const alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'QUOTE_EXPIRING')?.count).toBe(1);
  });

  it('signale une caisse ouverte depuis plus de 24 h', async () => {
    const s = await setup();
    const session = await openCashSession(
      { companyId: s.companyId, userId: s.userId },
      { locationId: s.locationId, openingAmount: 0n },
    );

    // Fraiche : pas d'alerte.
    let alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'CASH_OPEN')).toBeUndefined();

    await prisma.cashSession.update({
      where: { id: session.id },
      data: { openedAt: new Date(Date.now() - 30 * 3_600_000) },
    });
    alerts = await collectAlerts(s.companyId, ALL);
    expect(alerts.find((alert) => alert.kind === 'CASH_OPEN')?.severity).toBe('info');
  });
});

describe('permissions et isolation', () => {
  it("ne remonte que les alertes que l'utilisateur peut traiter", async () => {
    const s = await setup();
    await recordEntry(
      { companyId: s.companyId, userId: s.userId },
      { productId: s.productId, locationId: s.locationId, quantity: 100_000n },
    );
    await createInvoice(s.ctx, {
      customerId: s.customerId,
      locationId: s.locationId,
      issue: true,
      dueDate: new Date(Date.now() - 86_400_000),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    // Un role limite au stock ne doit pas apprendre l'etat des creances.
    const stockOnly = await collectAlerts(s.companyId, ['stock.read']);
    expect(stockOnly.every((alert) => alert.kind.startsWith('STOCK'))).toBe(true);

    const invoicesOnly = await collectAlerts(s.companyId, ['invoices.read']);
    expect(invoicesOnly.map((alert) => alert.kind)).toEqual(['INVOICE_OVERDUE']);

    expect(await collectAlerts(s.companyId, [])).toHaveLength(0);
  });

  it("n'expose jamais les alertes d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await recordEntry(
      { companyId: alpha.companyId, userId: alpha.userId },
      { productId: alpha.productId, locationId: alpha.locationId, quantity: 100_000n },
    );

    // Beta est en rupture, Alpha non : chacune voit son propre etat.
    const alphaAlerts = await collectAlerts(alpha.companyId, ALL);
    const betaAlerts = await collectAlerts(beta.companyId, ALL);

    expect(alphaAlerts.find((alert) => alert.kind === 'STOCK_OUT')).toBeUndefined();
    expect(betaAlerts.find((alert) => alert.kind === 'STOCK_OUT')?.count).toBe(1);
  });

  it('classe les alertes par gravite', async () => {
    const s = await setup();
    await createQuote(s.ctx, {
      customerId: s.customerId,
      validUntil: new Date(Date.now() + 86_400_000),
      lines: [{ productId: s.productId, quantity: 1_000n }],
    });

    const alerts = await collectAlerts(s.companyId, ALL);
    const severities = alerts.map((alert) => alert.severity);
    // Le critique passe avant l'avertissement, qui passe avant l'information.
    expect(severities).toEqual([...severities].sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 } as const;
      return order[a] - order[b];
    }));
  });
});

describe('canaux de diffusion', () => {
  it("n'annonce comme actif que ce qui fonctionne reellement", () => {
    const available = CHANNELS.filter((channel) => channel.available);
    expect(available.map((channel) => channel.key)).toEqual(['in-app']);

    // Annoncer un canal actif alors qu'il n'envoie rien serait pire que de ne
    // pas le proposer : l'utilisateur compterait sur une relance fantome.
    for (const channel of CHANNELS.filter((entry) => !entry.available)) {
      expect(channel.deliver).toBeUndefined();
    }
  });
});
