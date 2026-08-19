import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  cashBalance,
  cashOverview,
  closeCashSession,
  listCashMovements,
  openCashSession,
  recordCashMovement,
} from '@/server/services/cash';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  expensesByCategory,
  listExpenseCategories,
  listExpenses,
  recordExpense,
} from '@/server/services/expenses';
import { recordSale } from '@/server/services/sales';
import { deletePayment } from '@/server/services/payments';
import { createProduct } from '@/server/services/catalog';
import { createLocation } from '@/server/services/locations';
import { recordEntry } from '@/server/services/stock';
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

async function setup() {
  const company = await createTestCompany();
  const ctx = await serviceContext(company.companyId, company.userId);
  const product = await createProduct(company.companyId, productInput);

  await recordEntry(
    { companyId: company.companyId, userId: company.userId },
    { productId: product.id, locationId: company.locationId, quantity: 100_000n },
  );

  return {
    ...company,
    ctx,
    productId: product.id,
    cashId: await paymentMethodId(company.companyId, 'CASH'),
    momoId: await paymentMethodId(company.companyId, 'MOBILE_MONEY'),
    creditId: await paymentMethodId(company.companyId, 'CREDIT'),
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('session de caisse', () => {
  it('ouvre avec un fonds de caisse compte comme mouvement', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 20_000n });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(20_000n);
    const movements = await listCashMovements(s.companyId, {
      locationId: s.locationId,
      page: 1,
      pageSize: 10,
    });
    expect(movements.items[0]?.kind).toBe('OPENING');
  });

  it('refuse deux sessions ouvertes sur le meme point de vente', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });
    await expect(
      openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n }),
    ).rejects.toThrow(ConflictError);
  });

  it('autorise une session par point de vente', async () => {
    const s = await setup();
    const depot = await createLocation(s.companyId, {
      name: 'Depot',
      code: 'DEP',
      kind: 'WAREHOUSE',
      addressLine: undefined,
      city: undefined,
      phone: undefined,
      isDefault: false,
      isActive: true,
    });

    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });
    await expect(
      openCashSession(s.ctx, { locationId: depot.id, openingAmount: 0n }),
    ).resolves.toBeDefined();
  });

  it("refuse le point de vente d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await expect(
      openCashSession(alpha.ctx, { locationId: beta.locationId, openingAmount: 0n }),
    ).rejects.toThrow(NotFoundError);
  });

  it('ferme en constatant l ecart, sans le corriger', async () => {
    const s = await setup();
    const session = await openCashSession(s.ctx, {
      locationId: s.locationId,
      openingAmount: 20_000n,
    });

    await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
      payment: { methodId: s.cashId },
    });

    // Theorique : 20 000 + 30 000 = 50 000. Compte : 49 500 (manquant de 500).
    const closed = await closeCashSession(s.ctx, session.id, {
      countedAmount: 49_500n,
      notes: 'Manquant constate',
    });

    expect(closed.expectedAmount).toBe(50_000n);
    expect(closed.countedAmount).toBe(49_500n);
    expect(closed.difference).toBe(-500n);
    expect(closed.status).toBe('CLOSED');

    // L'ecart est constate mais le journal n'est pas rectifie : le solde reste
    // celui des mouvements enregistres.
    expect(await cashBalance(s.companyId, s.locationId)).toBe(50_000n);
  });

  it('refuse de fermer deux fois', async () => {
    const s = await setup();
    const session = await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });
    await closeCashSession(s.ctx, session.id, { countedAmount: 0n });
    await expect(
      closeCashSession(s.ctx, session.id, { countedAmount: 0n }),
    ).rejects.toThrow(ConflictError);
  });

  it('refuse un montant compte negatif', async () => {
    const s = await setup();
    const session = await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });
    await expect(
      closeCashSession(s.ctx, session.id, { countedAmount: -1n }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('encaissements et caisse', () => {
  it('une vente en especes alimente la caisse', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 10_000n });

    await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
      payment: { methodId: s.cashId },
    });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(55_000n);
  });

  it("une vente Mobile Money n'alimente pas la caisse", async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 10_000n });

    await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
      payment: { methodId: s.momoId, reference: 'MP-123' },
    });

    // L'argent est chez l'operateur, pas dans le tiroir.
    expect(await cashBalance(s.companyId, s.locationId)).toBe(10_000n);
  });

  it("une vente a credit n'alimente pas la caisse", async () => {
    const s = await setup();
    const customer = await prisma.partner.create({
      data: {
        companyId: s.companyId,
        kind: 'CUSTOMER',
        code: 'CLI-9999',
        name: 'Client credit',
        creditLimit: 500_000n,
      },
    });
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 10_000n });

    await recordSale(s.ctx, {
      customerId: customer.id,
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
    });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(10_000n);
  });

  it('enregistre les especes meme sans session ouverte', async () => {
    const s = await setup();
    // Aucune session : refuser la vente serait ingerable en boutique.
    await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
      payment: { methodId: s.cashId },
    });

    const overview = await cashOverview(s.companyId, s.locationId);
    expect(overview.balance).toBe(30_000n);
    expect(overview.session).toBeNull();
    // L'argent est dans le solde, mais hors de tout rapprochement : l'ecran le dit.
    expect(overview.outsideSession).toBe(30_000n);
  });

  it('annuler un paiement neutralise le mouvement de caisse sans le supprimer', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });

    const sale = await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 2_000n }],
      payment: { methodId: s.cashId },
    });
    expect(await cashBalance(s.companyId, s.locationId)).toBe(30_000n);

    await deletePayment(s.ctx, sale.paymentId!, 'Erreur de caisse');

    expect(await cashBalance(s.companyId, s.locationId)).toBe(0n);
    // Le journal reste en ajout seul : deux mouvements, pas zero.
    const movements = await listCashMovements(s.companyId, {
      locationId: s.locationId,
      page: 1,
      pageSize: 10,
    });
    expect(movements.total).toBe(2);
    expect(movements.items[0]?.kind).toBe('ADJUSTMENT');
  });
});

describe('mouvements manuels de caisse', () => {
  it('enregistre un apport et un retrait', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 0n });

    await recordCashMovement(s.ctx, {
      locationId: s.locationId,
      kind: 'DEPOSIT',
      amount: 50_000n,
      reason: 'Apport du gerant',
    });
    expect(await cashBalance(s.companyId, s.locationId)).toBe(50_000n);

    await recordCashMovement(s.ctx, {
      locationId: s.locationId,
      kind: 'WITHDRAWAL',
      amount: 20_000n,
      reason: 'Depot en banque',
    });
    expect(await cashBalance(s.companyId, s.locationId)).toBe(30_000n);
  });

  it('refuse un retrait superieur au solde', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 5_000n });

    await expect(
      recordCashMovement(s.ctx, {
        locationId: s.locationId,
        kind: 'WITHDRAWAL',
        amount: 10_000n,
        reason: 'Depot en banque',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('exige un motif et un montant positif', async () => {
    const s = await setup();
    for (const input of [
      { amount: 0n, reason: 'Apport' },
      { amount: 1_000n, reason: '   ' },
    ]) {
      await expect(
        recordCashMovement(s.ctx, {
          locationId: s.locationId,
          kind: 'DEPOSIT' as const,
          ...input,
        }),
      ).rejects.toThrow(ValidationError);
    }
  });
});

describe('depenses', () => {
  it('installe les categories a la creation de l entreprise', async () => {
    const s = await setup();
    const categories = await listExpenseCategories(s.companyId);
    expect(categories).toHaveLength(DEFAULT_EXPENSE_CATEGORIES.length);
    expect(categories.map((category) => category.name)).toContain('Loyer');
  });

  it('enregistre une depense et la sort de la caisse si elle est payee en especes', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 100_000n });
    const category = (await listExpenseCategories(s.companyId))[0]!;

    await recordExpense(s.ctx, {
      categoryId: category.id,
      locationId: s.locationId,
      methodId: s.cashId,
      amount: 15_000n,
      description: 'Carburant livraison',
    });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(85_000n);
  });

  it("une depense reglee par virement ne touche pas la caisse", async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 100_000n });
    const transferId = await paymentMethodId(s.companyId, 'BANK_TRANSFER');

    await recordExpense(s.ctx, {
      locationId: s.locationId,
      methodId: transferId,
      amount: 15_000n,
      description: 'Loyer',
    });

    expect(await cashBalance(s.companyId, s.locationId)).toBe(100_000n);
  });

  it('refuse une depense en especes superieure au solde de caisse', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 5_000n });

    await expect(
      recordExpense(s.ctx, {
        locationId: s.locationId,
        methodId: s.cashId,
        amount: 50_000n,
        description: 'Achat divers',
      }),
    ).rejects.toThrow(ValidationError);

    expect(await prisma.expense.count()).toBe(0);
  });

  it('refuse "Credit" comme mode de paiement d une depense', async () => {
    const s = await setup();
    await expect(
      recordExpense(s.ctx, {
        methodId: s.creditId,
        amount: 1_000n,
        description: 'Achat',
      }),
    ).rejects.toThrow(/Credit/);
  });

  it('exige un montant positif et une description', async () => {
    const s = await setup();
    await expect(
      recordExpense(s.ctx, { amount: 0n, description: 'Vide' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      recordExpense(s.ctx, { amount: 1_000n, description: '  ' }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuse la categorie d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    const betaCategory = (await listExpenseCategories(beta.companyId))[0]!;

    await expect(
      recordExpense(alpha.ctx, {
        categoryId: betaCategory.id,
        amount: 1_000n,
        description: 'Test',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('annuler une depense neutralise sa sortie de caisse', async () => {
    const s = await setup();
    await openCashSession(s.ctx, { locationId: s.locationId, openingAmount: 100_000n });

    const expense = await recordExpense(s.ctx, {
      locationId: s.locationId,
      methodId: s.cashId,
      amount: 15_000n,
      description: 'Carburant',
    });
    expect(await cashBalance(s.companyId, s.locationId)).toBe(85_000n);

    await deleteExpense(s.ctx, expense.id, 'Saisie en double');
    expect(await cashBalance(s.companyId, s.locationId)).toBe(100_000n);
  });

  it('agrege par categorie', async () => {
    const s = await setup();
    const categories = await listExpenseCategories(s.companyId);
    const transport = categories.find((category) => category.name === 'Transport')!;
    const loyer = categories.find((category) => category.name === 'Loyer')!;

    await recordExpense(s.ctx, { categoryId: transport.id, amount: 5_000n, description: 'Taxi' });
    await recordExpense(s.ctx, { categoryId: transport.id, amount: 3_000n, description: 'Essence' });
    await recordExpense(s.ctx, { categoryId: loyer.id, amount: 150_000n, description: 'Loyer aout' });

    const summary = await expensesByCategory(s.companyId);
    expect(summary[0]?.name).toBe('Loyer');
    expect(summary[0]?.total).toBe(150_000n);
    expect(summary[1]?.name).toBe('Transport');
    expect(summary[1]?.total).toBe(8_000n);
    expect(summary[1]?.count).toBe(2);
  });

  it('categorie personnalisee : creation puis desactivation si utilisee', async () => {
    const s = await setup();
    const category = await createExpenseCategory(s.companyId, 'Securite');
    expect(category.isSystem).toBe(false);

    await recordExpense(s.ctx, {
      categoryId: category.id,
      amount: 20_000n,
      description: 'Gardiennage',
    });

    const result = await deleteExpenseCategory(s.companyId, category.id);
    expect(result?.isActive).toBe(false);
    expect(await prisma.expenseCategory.count({ where: { id: category.id } })).toBe(1);
  });

  it("n'expose pas les depenses d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();
    await recordExpense(beta.ctx, { amount: 1_000n, description: 'Depense Beta' });

    expect((await listExpenses(alpha.companyId, { page: 1, pageSize: 25 })).total).toBe(0);
  });
});

describe('invariant caisse', () => {
  it('le solde egale toujours la somme des mouvements', async () => {
    const s = await setup();
    const session = await openCashSession(s.ctx, {
      locationId: s.locationId,
      openingAmount: 25_000n,
    });

    await recordSale(s.ctx, {
      locationId: s.locationId,
      lines: [{ productId: s.productId, quantity: 3_000n }],
      payment: { methodId: s.cashId },
    });
    await recordExpense(s.ctx, {
      locationId: s.locationId,
      methodId: s.cashId,
      amount: 12_500n,
      description: 'Transport',
    });
    await recordCashMovement(s.ctx, {
      locationId: s.locationId,
      kind: 'WITHDRAWAL',
      amount: 30_000n,
      reason: 'Depot en banque',
    });
    await recordCashMovement(s.ctx, {
      locationId: s.locationId,
      kind: 'DEPOSIT',
      amount: 7_500n,
      reason: 'Appoint',
    });

    const movements = await prisma.cashMovement.findMany({
      where: { companyId: s.companyId, locationId: s.locationId },
      select: { amount: true },
    });
    const sum = movements.reduce((total, movement) => total + movement.amount, 0n);

    // 25 000 + 45 000 - 12 500 - 30 000 + 7 500 = 35 000.
    expect(sum).toBe(35_000n);
    expect(await cashBalance(s.companyId, s.locationId)).toBe(sum);

    const closed = await closeCashSession(s.ctx, session.id, { countedAmount: 35_000n });
    expect(closed.difference).toBe(0n);
  });
});
