import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Lectures du stock : soldes, alertes de rupture, historique et valorisation.
 * Aucune ecriture ici.
 */

export interface StockListQuery {
  page: number;
  pageSize: number;
  search?: string;
  locationId?: string;
  categoryId?: string;
  /** Ne remonter que les articles au niveau ou sous leur seuil d'alerte. */
  lowOnly?: boolean;
}

export interface StockRow {
  productId: string;
  name: string;
  sku: string;
  unitSymbol: string;
  categoryName: string;
  minStock: bigint;
  costPrice: bigint;
  quantity: bigint;
  isLow: boolean;
  isOut: boolean;
  value: bigint;
}

/**
 * Etat du stock, article par article.
 *
 * Sans point de vente precise, les soldes de tous les points de vente sont
 * additionnes : c'est la vue consolidee dont le dirigeant a besoin. Avec un
 * point de vente, seul celui-ci est pris en compte.
 */
export async function listStock(companyId: string, query: StockListQuery) {
  const search = query.search?.trim();

  const productWhere: Prisma.ProductWhereInput = {
    companyId,
    isActive: true,
    trackStock: true,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
            { barcode: { equals: search } },
          ],
        }
      : {}),
  };

  const products = await prisma.product.findMany({
    where: productWhere,
    include: {
      unit: { select: { symbol: true } },
      category: { select: { name: true } },
      stockLevels: {
        where: query.locationId ? { locationId: query.locationId } : {},
        select: { quantity: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const rows: StockRow[] = products.map((product) => {
    const quantity = product.stockLevels.reduce((total, level) => total + level.quantity, 0n);
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unitSymbol: product.unit?.symbol ?? '',
      categoryName: product.category?.name ?? '',
      minStock: product.minStock,
      costPrice: product.costPrice,
      quantity,
      isOut: quantity <= 0n,
      // Le seuil est inclusif : atteindre exactement le minimum est deja le
      // moment de recommander, pas le moment de le constater.
      isLow: product.minStock > 0n && quantity <= product.minStock,
      value: (quantity * product.costPrice) / 1000n,
    };
  });

  const filtered = query.lowOnly ? rows.filter((row) => row.isLow || row.isOut) : rows;
  const start = (query.page - 1) * query.pageSize;

  return {
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
    items: filtered.slice(start, start + query.pageSize),
  };
}

/** Synthese affichee en tete de l'ecran Stock et sur le tableau de bord. */
export async function stockSummary(companyId: string, locationId?: string) {
  const products = await prisma.product.findMany({
    where: { companyId, isActive: true, trackStock: true },
    select: {
      minStock: true,
      costPrice: true,
      stockLevels: {
        where: locationId ? { locationId } : {},
        select: { quantity: true },
      },
    },
  });

  let totalValue = 0n;
  let lowCount = 0;
  let outCount = 0;

  for (const product of products) {
    const quantity = product.stockLevels.reduce((total, level) => total + level.quantity, 0n);
    totalValue += (quantity * product.costPrice) / 1000n;
    if (quantity <= 0n) outCount += 1;
    else if (product.minStock > 0n && quantity <= product.minStock) lowCount += 1;
  }

  return { trackedProducts: products.length, totalValue, lowCount, outCount };
}

export interface MovementListQuery {
  page: number;
  pageSize: number;
  productId?: string;
  locationId?: string;
  kind?: string;
}

export async function listMovements(companyId: string, query: MovementListQuery) {
  const where: Prisma.StockMovementWhereInput = {
    companyId,
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true, unit: { select: { symbol: true } } } },
        location: { select: { name: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items,
  };
}

/** Detail des soldes d'un article, point de vente par point de vente. */
export async function productStockByLocation(companyId: string, productId: string) {
  return prisma.stockLevel.findMany({
    where: { companyId, productId },
    include: { location: { select: { id: true, name: true, isActive: true } } },
    orderBy: { location: { name: 'asc' } },
  });
}

/**
 * Recalcule le solde d'un article a partir du seul journal.
 *
 * Sert de controle d'integrite : le resultat doit toujours egaler le
 * `StockLevel` enregistre. La suite de tests s'en sert pour verifier
 * l'invariant apres chaque scenario.
 */
export async function recomputeStockFromMovements(
  companyId: string,
  productId: string,
  locationId: string,
): Promise<bigint> {
  const movements = await prisma.stockMovement.findMany({
    where: { companyId, productId, locationId },
    select: { quantity: true },
  });
  return movements.reduce((total, movement) => total + movement.quantity, 0n);
}
