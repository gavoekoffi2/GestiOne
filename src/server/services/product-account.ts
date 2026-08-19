import { prisma } from '@/server/db';
import { multiplyByQuantity } from '@/lib/money';
import { getProduct } from '@/server/services/catalog';
import { productStockByLocation } from '@/server/services/stock-query';

/**
 * Fiche d'un article : ou est-il, combien s'en vend-il, et rapporte-t-il
 * quelque chose.
 *
 * Les trois informations vivaient dans trois ecrans differents — le catalogue
 * pour les prix, le stock pour les quantites, les rapports pour les ventes —
 * et aucun ne repondait a la question posee devant le rayon : « je reapprovisionne
 * ou pas ? ».
 *
 * **La marge est calculee sur les couts figes dans les lignes de facture**
 * (`InvoiceLine.unitCost`), pas sur le prix d'achat actuel de l'article. C'est
 * la seule facon d'avoir une marge historique juste : si le fournisseur augmente
 * ses tarifs, les ventes du mois dernier ne doivent pas devenir retroactivement
 * moins rentables.
 */

/** Fenetre d'analyse des ventes : assez longue pour lisser, assez courte pour decrire la situation actuelle. */
export const SALES_WINDOW_DAYS = 90;

/** Nombre de mouvements de stock affiches sur la fiche. */
const MOVEMENT_LIMIT = 20;

export interface ProductAccount {
  product: Awaited<ReturnType<typeof getProduct>>;
  levels: Awaited<ReturnType<typeof productStockByLocation>>;
  /** Somme des soldes, tous points de vente confondus, en milliemes. */
  totalQuantity: bigint;
  /** Valorisation du stock au prix d'achat courant. */
  stockValue: bigint;
  /** Points de vente ou l'article est sous son seuil d'alerte. */
  lowLocations: Array<{ locationId: string; locationName: string; quantity: bigint }>;
  /** Quantite vendue sur la fenetre d'analyse, en milliemes. */
  soldQuantity: bigint;
  /** Chiffre d'affaires realise sur la fenetre, taxes comprises. */
  soldRevenue: bigint;
  /** Cout d'achat des quantites vendues, fige a l'emission. */
  soldCost: bigint;
  /** Marge brute de la fenetre : revenu moins cout. Peut etre negative. */
  margin: bigint;
  /** Taux de marge en pourcentage, ou `null` si rien n'a ete vendu. */
  marginPercent: number | null;
  /** Nombre de factures contenant l'article sur la fenetre. */
  invoiceCount: number;
  movements: Array<{
    id: string;
    kind: string;
    quantity: bigint;
    quantityAfter: bigint;
    locationName: string;
    reason: string | null;
    reference: string | null;
    userName: string | null;
    createdAt: Date;
  }>;
  lastSaleAt: Date | null;
  lastPurchaseAt: Date | null;
}

export async function getProductAccount(
  companyId: string,
  productId: string,
  now: Date = new Date(),
): Promise<ProductAccount> {
  const product = await getProduct(companyId, productId);
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Une facture annulee a restitue son stock : compter ses lignes dans les
  // ventes ferait apparaitre un chiffre d'affaires qui n'a jamais eu lieu.
  const soldScope = {
    productId,
    invoice: {
      companyId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      issueDate: { gte: since },
    },
  };

  const [levels, sold, invoiceGroups, movements, lastSale, lastPurchase] = await Promise.all([
    productStockByLocation(companyId, productId),
    prisma.invoiceLine.aggregate({
      where: soldScope,
      _sum: { quantity: true, lineTotal: true },
    }),
    prisma.invoiceLine.groupBy({ by: ['invoiceId'], where: soldScope }),
    prisma.stockMovement.findMany({
      where: { companyId, productId },
      orderBy: { createdAt: 'desc' },
      take: MOVEMENT_LIMIT,
      include: {
        location: { select: { name: true } },
        user: { select: { fullName: true } },
      },
    }),
    prisma.invoiceLine.findFirst({
      where: {
        productId,
        invoice: { companyId, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      },
      orderBy: { invoice: { issueDate: 'desc' } },
      select: { invoice: { select: { issueDate: true } } },
    }),
    prisma.purchaseOrderLine.findFirst({
      where: {
        productId,
        order: { companyId, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      },
      orderBy: { order: { orderDate: 'desc' } },
      select: { order: { select: { orderDate: true } } },
    }),
  ]);

  // Le cout des ventes ne peut pas s'obtenir par `_sum` : il vaut
  // quantite x cout unitaire, ligne par ligne. Prisma n'agrege pas un produit
  // de deux colonnes, et la quantite est en milliemes.
  const soldLines = await prisma.invoiceLine.findMany({
    where: soldScope,
    select: { quantity: true, unitCost: true },
  });
  const soldCost = soldLines.reduce(
    (total, line) => total + multiplyByQuantity(line.unitCost, line.quantity),
    0n,
  );

  const totalQuantity = levels.reduce((total, level) => total + level.quantity, 0n);
  const soldQuantity = sold._sum.quantity ?? 0n;
  const soldRevenue = sold._sum.lineTotal ?? 0n;
  const margin = soldRevenue - soldCost;

  return {
    product,
    levels,
    totalQuantity,
    stockValue: multiplyByQuantity(product.costPrice, totalQuantity),
    lowLocations:
      product.trackStock && product.minStock > 0n
        ? levels
            .filter((level) => level.quantity < product.minStock)
            .map((level) => ({
              locationId: level.locationId,
              locationName: level.location.name,
              quantity: level.quantity,
            }))
        : [],
    soldQuantity,
    soldRevenue,
    soldCost,
    margin,
    marginPercent: soldRevenue > 0n ? Number((margin * 100n) / soldRevenue) : null,
    invoiceCount: invoiceGroups.length,
    movements: movements.map((movement) => ({
      id: movement.id,
      kind: movement.kind,
      quantity: movement.quantity,
      quantityAfter: movement.quantityAfter,
      locationName: movement.location.name,
      reason: movement.reason,
      reference: movement.reference,
      userName: movement.user?.fullName ?? null,
      createdAt: movement.createdAt,
    })),
    lastSaleAt: lastSale?.invoice?.issueDate ?? null,
    lastPurchaseAt: lastPurchase?.order?.orderDate ?? null,
  };
}
