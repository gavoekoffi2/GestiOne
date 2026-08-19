import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  recordEntry,
  recordExit,
  recordInventory,
  recordTransfer,
} from '@/server/services/stock';
import {
  listMovements,
  listStock,
  productStockByLocation,
  recomputeStockFromMovements,
  stockSummary,
} from '@/server/services/stock-query';
import { createProduct } from '@/server/services/catalog';
import { createLocation } from '@/server/services/locations';
import { NotFoundError, ValidationError } from '@/server/errors';
import { createTestCompany, resetDatabase } from '../helpers';

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
  minStock: 5_000n, // 5 unites
  isActive: true,
};

async function setup() {
  const company = await createTestCompany();
  const product = await createProduct(company.companyId, productInput);
  const depot = await createLocation(company.companyId, {
    name: 'Depot Yopougon',
    code: 'YOP',
    kind: 'WAREHOUSE',
    addressLine: undefined,
    city: undefined,
    phone: undefined,
    isDefault: false,
    isActive: true,
  });
  return {
    ...company,
    productId: product.id,
    shopId: company.locationId,
    depotId: depot.id,
    ctx: { companyId: company.companyId, userId: company.userId },
  };
}

beforeEach(async () => {
  await resetDatabase();
});

describe('entrees et sorties', () => {
  it('cree le solde a la premiere entree', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 20_000n });

    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_locationId: { productId: s.productId, locationId: s.shopId } },
    });
    expect(level.quantity).toBe(20_000n);
  });

  it('fige le solde apres mouvement dans le journal', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 20_000n });
    await recordExit(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 3_000n });

    const movements = await prisma.stockMovement.findMany({ orderBy: { createdAt: 'asc' } });
    expect(movements.map((movement) => movement.quantityAfter)).toEqual([20_000n, 17_000n]);
    expect(movements.map((movement) => movement.quantity)).toEqual([20_000n, -3_000n]);
  });

  it('refuse une sortie superieure au stock disponible', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 2_000n });

    await expect(
      recordExit(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 5_000n }),
    ).rejects.toThrow(ValidationError);

    // L'echec ne doit laisser ni mouvement ni solde modifie.
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(2_000n);
    expect(await prisma.stockMovement.count()).toBe(1);
  });

  it('refuse une quantite nulle ou negative', async () => {
    const s = await setup();
    for (const quantity of [0n, -1_000n]) {
      await expect(
        recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity }),
      ).rejects.toThrow(ValidationError);
    }
  });

  it('refuse un mouvement sur un service', async () => {
    const s = await setup();
    const service = await createProduct(s.companyId, {
      ...productInput,
      kind: 'SERVICE',
      name: 'Livraison',
    });

    await expect(
      recordEntry(s.ctx, { productId: service.id, locationId: s.shopId, quantity: 1_000n }),
    ).rejects.toThrow(/service/);
  });

  it('gere les quantites fractionnaires', async () => {
    const s = await setup();
    // 0,750 kg puis 0,250 kg : le total doit tomber juste sur 1 kg.
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 750n });
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 250n });

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(1_000n);
  });
});

describe('isolation entre entreprises et points de vente', () => {
  it("refuse l'article d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    await expect(
      recordEntry(alpha.ctx, { productId: beta.productId, locationId: alpha.shopId, quantity: 1_000n }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuse le point de vente d'une autre entreprise", async () => {
    const alpha = await setup();
    const beta = await setup();

    await expect(
      recordEntry(alpha.ctx, { productId: alpha.productId, locationId: beta.shopId, quantity: 1_000n }),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuse un point de vente desactive', async () => {
    const s = await setup();
    await prisma.location.update({ where: { id: s.depotId }, data: { isActive: false } });

    await expect(
      recordEntry(s.ctx, { productId: s.productId, locationId: s.depotId, quantity: 1_000n }),
    ).rejects.toThrow(NotFoundError);
  });

  it('tient des soldes distincts par point de vente', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.depotId, quantity: 4_000n });

    const levels = await productStockByLocation(s.companyId, s.productId);
    expect(levels).toHaveLength(2);
    expect(levels.reduce((total, level) => total + level.quantity, 0n)).toBe(14_000n);
  });
});

describe('transferts', () => {
  it('deplace la marchandise entre deux points de vente', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });

    const transfer = await recordTransfer(s.ctx, {
      productId: s.productId,
      fromLocationId: s.shopId,
      toLocationId: s.depotId,
      quantity: 4_000n,
    });

    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(6_000n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.depotId)).toBe(4_000n);

    // Les deux ecritures portent le meme identifiant de transfert.
    const paired = await prisma.stockMovement.findMany({
      where: { transferId: transfer.transferId },
    });
    expect(paired).toHaveLength(2);
    expect(paired.map((movement) => movement.kind).sort()).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
  });

  it('ne laisse aucune ecriture orpheline si le stock est insuffisant', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 1_000n });

    await expect(
      recordTransfer(s.ctx, {
        productId: s.productId,
        fromLocationId: s.shopId,
        toLocationId: s.depotId,
        quantity: 5_000n,
      }),
    ).rejects.toThrow(ValidationError);

    // La marchandise ne doit jamais entrer quelque part sans etre sortie ailleurs.
    expect(await prisma.stockMovement.count({ where: { kind: 'TRANSFER_IN' } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { kind: 'TRANSFER_OUT' } })).toBe(0);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.depotId)).toBe(0n);
  });

  it('refuse un transfert vers le meme point de vente', async () => {
    const s = await setup();
    await expect(
      recordTransfer(s.ctx, {
        productId: s.productId,
        fromLocationId: s.shopId,
        toLocationId: s.shopId,
        quantity: 1_000n,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('conserve le total consolide de l entreprise', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });
    await recordTransfer(s.ctx, {
      productId: s.productId,
      fromLocationId: s.shopId,
      toLocationId: s.depotId,
      quantity: 4_000n,
    });

    const consolidated = await listStock(s.companyId, { page: 1, pageSize: 25 });
    expect(consolidated.items[0]?.quantity).toBe(10_000n);
  });
});

describe('inventaire', () => {
  it('enregistre l ecart calcule, a la hausse comme a la baisse', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });

    await recordInventory(s.ctx, {
      productId: s.productId,
      locationId: s.shopId,
      countedQuantity: 8_000n,
      reason: 'Inventaire mensuel',
    });
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(8_000n);

    await recordInventory(s.ctx, {
      productId: s.productId,
      locationId: s.shopId,
      countedQuantity: 9_500n,
      reason: 'Recomptage',
    });
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(9_500n);

    const movements = await prisma.stockMovement.findMany({
      where: { kind: 'INVENTORY' },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((movement) => movement.quantity)).toEqual([-2_000n, 1_500n]);
  });

  it('refuse un inventaire sans ecart', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });

    await expect(
      recordInventory(s.ctx, {
        productId: s.productId,
        locationId: s.shopId,
        countedQuantity: 10_000n,
        reason: 'Controle',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('exige un motif', async () => {
    const s = await setup();
    await expect(
      recordInventory(s.ctx, {
        productId: s.productId,
        locationId: s.shopId,
        countedQuantity: 5_000n,
        reason: '   ',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('refuse une quantite comptee negative', async () => {
    const s = await setup();
    await expect(
      recordInventory(s.ctx, {
        productId: s.productId,
        locationId: s.shopId,
        countedQuantity: -1_000n,
        reason: 'Erreur',
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('journal append-only', () => {
  it('conserve chaque mouvement, y compris apres correction', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });
    await recordExit(s.ctx, {
      productId: s.productId,
      locationId: s.shopId,
      quantity: 2_000n,
      reason: 'Casse',
    });
    await recordInventory(s.ctx, {
      productId: s.productId,
      locationId: s.shopId,
      countedQuantity: 7_000n,
      reason: 'Inventaire',
    });

    // Trois mouvements enregistres, trois mouvements conserves : corriger un
    // stock n'efface jamais ce qui a ete constate auparavant.
    const journal = await listMovements(s.companyId, { page: 1, pageSize: 50 });
    expect(journal.total).toBe(3);
    expect(journal.items.map((movement) => movement.kind)).toEqual([
      'INVENTORY',
      'OUT',
      'IN',
    ]);
  });

  it('journalise chaque mouvement dans l audit', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });
    await recordTransfer(s.ctx, {
      productId: s.productId,
      fromLocationId: s.shopId,
      toLocationId: s.depotId,
      quantity: 1_000n,
    });

    const audits = await prisma.auditLog.findMany({ where: { action: 'STOCK_MOVE' } });
    expect(audits).toHaveLength(2);
  });
});

describe('invariant solde = somme des mouvements', () => {
  it('tient apres une sequence melangeant tous les types', async () => {
    const s = await setup();

    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 50_000n });
    await recordExit(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 7_500n });
    await recordTransfer(s.ctx, {
      productId: s.productId,
      fromLocationId: s.shopId,
      toLocationId: s.depotId,
      quantity: 12_000n,
    });
    await recordInventory(s.ctx, {
      productId: s.productId,
      locationId: s.depotId,
      countedQuantity: 11_250n,
      reason: 'Inventaire depot',
    });
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.depotId, quantity: 3_750n });

    for (const locationId of [s.shopId, s.depotId]) {
      const level = await prisma.stockLevel.findUniqueOrThrow({
        where: { productId_locationId: { productId: s.productId, locationId } },
      });
      const journal = await recomputeStockFromMovements(s.companyId, s.productId, locationId);
      expect(level.quantity).toBe(journal);
    }
  });

  it('tient sous concurrence : le stock ne passe jamais en negatif', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });

    // Vingt sorties simultanees de 1 unite pour 10 unites disponibles :
    // exactement dix doivent aboutir.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        recordExit(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 1_000n }),
      ),
    );

    const accepted = results.filter((result) => result.status === 'fulfilled').length;
    expect(accepted).toBe(10);

    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_locationId: { productId: s.productId, locationId: s.shopId } },
    });
    expect(level.quantity).toBe(0n);
    expect(await recomputeStockFromMovements(s.companyId, s.productId, s.shopId)).toBe(0n);
  });
});

describe('alertes et valorisation', () => {
  it('signale les articles au niveau ou sous le seuil, et les ruptures', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 5_000n });

    const rows = await listStock(s.companyId, { page: 1, pageSize: 25 });
    const row = rows.items[0]!;
    // Seuil a 5 : etre exactement a 5 est deja le moment de recommander.
    expect(row.isLow).toBe(true);
    expect(row.isOut).toBe(false);

    await recordExit(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 5_000n });
    const after = await listStock(s.companyId, { page: 1, pageSize: 25 });
    expect(after.items[0]?.isOut).toBe(true);
  });

  it('filtre sur les seules alertes', async () => {
    const s = await setup();
    const other = await createProduct(s.companyId, {
      ...productInput,
      name: 'Huile 5 L',
      minStock: 2_000n,
    });
    await recordEntry(s.ctx, { productId: other.id, locationId: s.shopId, quantity: 50_000n });
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 1_000n });

    const alerts = await listStock(s.companyId, { page: 1, pageSize: 25, lowOnly: true });
    expect(alerts.total).toBe(1);
    expect(alerts.items[0]?.name).toBe('Sac de riz 25 kg');
  });

  it('valorise le stock au prix d achat', async () => {
    const s = await setup();
    // 10 sacs a 12 000 F = 120 000 F.
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });

    const summary = await stockSummary(s.companyId);
    expect(summary.totalValue).toBe(120_000n);
    expect(summary.lowCount).toBe(0);
    expect(summary.outCount).toBe(0);
  });

  it('valorise correctement une quantite fractionnaire', async () => {
    const s = await setup();
    // 2,5 sacs a 12 000 F = 30 000 F.
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 2_500n });

    expect((await stockSummary(s.companyId)).totalValue).toBe(30_000n);
  });

  it('ignore les services dans la valorisation', async () => {
    const s = await setup();
    await createProduct(s.companyId, { ...productInput, kind: 'SERVICE', name: 'Livraison' });

    expect((await stockSummary(s.companyId)).trackedProducts).toBe(1);
  });

  it('limite la synthese a un point de vente quand il est precise', async () => {
    const s = await setup();
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.shopId, quantity: 10_000n });
    await recordEntry(s.ctx, { productId: s.productId, locationId: s.depotId, quantity: 5_000n });

    expect((await stockSummary(s.companyId)).totalValue).toBe(180_000n);
    expect((await stockSummary(s.companyId, s.depotId)).totalValue).toBe(60_000n);
  });
});
