import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { nextDocumentNumber } from '@/server/sequences';
import { applyMovement } from '@/server/services/stock';
import { balanceDue, computeTotals, type LineInput } from '@/lib/totals';
import { formatQuantity } from '@/lib/quantity';

/**
 * Achats fournisseur.
 *
 * `PurchaseOrder` est le **document de dette unique**, symetrique de `Invoice`
 * cote clients : ce que l'entreprise doit a ses fournisseurs se lit ici et
 * nulle part ailleurs. Un achat direct, sans commande prealable, est simplement
 * une commande creee et receptionnee dans la foulee.
 *
 * La reception est ce qui fait entrer la marchandise en stock. Elle peut etre
 * partielle — c'est le cas courant — et se repete jusqu'a la quantite commandee.
 */

export type PurchaseStatus =
  | 'DRAFT'
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Brouillon',
  ORDERED: 'Commandee',
  PARTIALLY_RECEIVED: 'Partiellement recue',
  RECEIVED: 'Recue',
  CANCELLED: 'Annulee',
};

export interface PurchaseContext {
  companyId: string;
  userId: string;
  purchasePrefix: string;
  defaultDueDays: number;
}

export interface PurchaseLineInput {
  productId?: string;
  description?: string;
  quantity: bigint;
  unitCost?: bigint;
  discountRate?: number;
  taxRateId?: string;
}

export interface CreatePurchaseInput {
  supplierId?: string;
  locationId?: string;
  orderDate?: Date;
  expectedAt?: Date;
  dueDate?: Date;
  lines: PurchaseLineInput[];
  discountAmount?: bigint;
  discountRate?: number;
  notes?: string;
  reference?: string;
  /** Passer directement la commande (et non la laisser en brouillon). */
  order?: boolean;
  /** Receptionner integralement dans la foulee : cas de l'achat direct. */
  receiveNow?: boolean;
}

interface ResolvedPurchaseLine {
  input: PurchaseLineInput;
  product: { id: string; name: string; costPrice: bigint; trackStock: boolean } | null;
  description: string;
  unitCost: bigint;
  taxRate: number;
  taxRateId: string | null;
}

async function resolveLines(
  companyId: string,
  lines: readonly PurchaseLineInput[],
): Promise<ResolvedPurchaseLine[]> {
  if (lines.length === 0) {
    throw new ValidationError('Une commande doit comporter au moins une ligne.');
  }

  const productIds = [...new Set(lines.map((line) => line.productId).filter(Boolean))] as string[];
  const taxRateIds = [...new Set(lines.map((line) => line.taxRateId).filter(Boolean))] as string[];

  const [products, taxRates] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, companyId },
          select: { id: true, name: true, costPrice: true, trackStock: true, isActive: true },
        })
      : Promise.resolve([]),
    taxRateIds.length
      ? prisma.taxRate.findMany({
          where: { id: { in: taxRateIds }, companyId },
          select: { id: true, rate: true },
        })
      : Promise.resolve([]),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const taxById = new Map(taxRates.map((tax) => [tax.id, tax]));

  return lines.map((line, index) => {
    const position = index + 1;
    if (line.quantity <= 0n) {
      throw new ValidationError(`Ligne ${position} : la quantite doit etre superieure a zero.`);
    }

    let product: ResolvedPurchaseLine['product'] = null;
    if (line.productId) {
      const found = productById.get(line.productId);
      if (!found) throw new NotFoundError(`Ligne ${position} : article introuvable.`);
      product = found;
    }

    const description = line.description?.trim() || product?.name;
    if (!description) throw new ValidationError(`Ligne ${position} : indiquez une designation.`);

    // Le cout saisi prime : c'est le prix reellement negocie pour ce lot, qui
    // peut differer du prix d'achat de reference du catalogue.
    const unitCost = line.unitCost ?? product?.costPrice;
    if (unitCost === undefined) {
      throw new ValidationError(`Ligne ${position} : indiquez un cout unitaire.`);
    }
    if (unitCost < 0n) {
      throw new ValidationError(`Ligne ${position} : le cout unitaire ne peut pas etre negatif.`);
    }

    let taxRate = 0;
    let taxRateId: string | null = null;
    if (line.taxRateId) {
      const tax = taxById.get(line.taxRateId);
      if (!tax) throw new NotFoundError(`Ligne ${position} : taux de taxe introuvable.`);
      taxRate = tax.rate;
      taxRateId = tax.id;
    }

    return { input: line, product, description, unitCost, taxRate, taxRateId };
  });
}

export async function createPurchaseOrder(
  context: PurchaseContext,
  input: CreatePurchaseInput,
) {
  const resolved = await resolveLines(context.companyId, input.lines);

  if (input.supplierId) {
    const supplier = await prisma.partner.findFirst({
      where: { id: input.supplierId, companyId: context.companyId, kind: 'SUPPLIER' },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError('Fournisseur introuvable.');
  }

  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, companyId: context.companyId, isActive: true },
      select: { id: true },
    });
    if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');
  }

  if (input.receiveNow && !input.locationId && resolved.some((line) => line.product?.trackStock)) {
    throw new ValidationError(
      'Precisez le point de vente : la marchandise receptionnee doit entrer quelque part.',
    );
  }

  const totalsInput: LineInput[] = resolved.map((line) => ({
    quantity: line.input.quantity,
    unitPrice: line.unitCost,
    discountRate: line.input.discountRate ?? 0,
    taxRate: line.taxRate,
  }));
  const totals = computeTotals(totalsInput, {
    amount: input.discountAmount,
    rate: input.discountRate,
  });

  const orderDate = input.orderDate ?? new Date();
  const dueDate =
    input.dueDate ?? new Date(orderDate.getTime() + context.defaultDueDays * 24 * 60 * 60 * 1000);

  const placed = input.order || input.receiveNow;

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, context.companyId, 'PURCHASE', {
      prefix: context.purchasePrefix,
      now: orderDate,
    });

    const order = await tx.purchaseOrder.create({
      data: {
        companyId: context.companyId,
        number,
        supplierId: input.supplierId ?? null,
        locationId: input.locationId ?? null,
        status: input.receiveNow ? 'RECEIVED' : placed ? 'ORDERED' : 'DRAFT',
        orderDate,
        expectedAt: input.expectedAt ?? null,
        dueDate,
        subtotal: totals.subtotal,
        discountAmount: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        paidAmount: 0n,
        // Une commande en brouillon n'engage rien : elle ne cree pas de dette.
        balanceDue: placed ? totals.total : 0n,
        notes: input.notes ?? null,
        reference: input.reference ?? null,
        userId: context.userId,
        lines: {
          create: resolved.map((line, index) => ({
            productId: line.product?.id ?? null,
            description: line.description,
            quantity: line.input.quantity,
            receivedQuantity: input.receiveNow ? line.input.quantity : 0n,
            unitCost: line.unitCost,
            discountRate: line.input.discountRate ?? 0,
            taxRateId: line.taxRateId,
            taxRate: line.taxRate,
            taxable: totals.lines[index]!.taxable,
            taxAmount: totals.lines[index]!.tax,
            lineTotal: totals.lines[index]!.total,
            position: index + 1,
          })),
        },
      },
      include: { lines: true },
    });

    if (input.receiveNow && input.locationId) {
      for (const line of resolved) {
        if (!line.product?.trackStock) continue;
        await applyMovement(tx, {
          companyId: context.companyId,
          productId: line.product.id,
          locationId: input.locationId,
          kind: 'IN',
          delta: line.input.quantity,
          unitCost: line.unitCost,
          reason: `Reception ${number}`,
          reference: number,
          userId: context.userId,
        });
      }
    }

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CREATE',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      summary: `Commande fournisseur ${number} creee (${PURCHASE_STATUS_LABELS[order.status as PurchaseStatus]})`,
      metadata: { total: totals.total.toString() },
    });

    return order;
  });
}

/** Passe une commande jusque-la en brouillon : la dette devient exigible. */
export async function placeOrder(context: PurchaseContext, orderId: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, companyId: context.companyId },
    select: { id: true, number: true, status: true, total: true },
  });
  if (!order) throw new NotFoundError('Commande introuvable.');
  if (order.status !== 'DRAFT') {
    throw new ConflictError(
      `Cette commande est deja ${PURCHASE_STATUS_LABELS[order.status as PurchaseStatus].toLowerCase()}.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'ORDERED', balanceDue: order.total },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'UPDATE',
      entityType: 'PurchaseOrder',
      entityId: orderId,
      summary: `Commande ${order.number} passee au fournisseur`,
    });

    return updated;
  });
}

export interface ReceiveInput {
  locationId?: string;
  /** Quantites recues par ligne. Une ligne absente n'est pas receptionnee. */
  lines: Array<{ lineId: string; quantity: bigint }>;
}

/**
 * Receptionne tout ou partie d'une commande : la marchandise entre en stock et
 * les quantites recues sont cumulees. Recevoir plus que commande est refuse —
 * c'est presque toujours une erreur de saisie, et cela fausserait le stock.
 */
export async function receiveOrder(
  context: PurchaseContext,
  orderId: string,
  input: ReceiveInput,
) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, companyId: context.companyId },
    include: { lines: { include: { product: true } } },
  });
  if (!order) throw new NotFoundError('Commande introuvable.');
  if (order.status === 'CANCELLED') {
    throw new ConflictError('Cette commande est annulee.');
  }
  if (order.status === 'RECEIVED') {
    throw new ConflictError('Cette commande a deja ete entierement receptionnee.');
  }

  const locationId = input.locationId ?? order.locationId;
  const linesById = new Map(order.lines.map((line) => [line.id, line]));

  const receipts = input.lines.filter((entry) => entry.quantity > 0n);
  if (receipts.length === 0) {
    throw new ValidationError('Indiquez au moins une quantite receptionnee.');
  }

  for (const entry of receipts) {
    const line = linesById.get(entry.lineId);
    if (!line) throw new NotFoundError('Ligne de commande introuvable.');

    const remaining = line.quantity - line.receivedQuantity;
    if (entry.quantity > remaining) {
      throw new ValidationError(
        `"${line.description}" : vous receptionnez ${formatQuantity(entry.quantity)} alors qu'il ne reste que ${formatQuantity(remaining)} a recevoir.`,
      );
    }
    if (line.product?.trackStock && !locationId) {
      throw new ValidationError(
        'Precisez le point de vente : la marchandise receptionnee doit entrer quelque part.',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    for (const entry of receipts) {
      const line = linesById.get(entry.lineId)!;

      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQuantity: line.receivedQuantity + entry.quantity },
      });

      if (line.product?.trackStock && locationId) {
        await applyMovement(tx, {
          companyId: context.companyId,
          productId: line.productId as string,
          locationId,
          kind: 'IN',
          delta: entry.quantity,
          unitCost: line.unitCost,
          reason: `Reception ${order.number}`,
          reference: order.number,
          userId: context.userId,
        });
      }
    }

    // Le statut se deduit des quantites reellement recues, jamais d'un drapeau
    // pose a la main qui pourrait mentir sur l'etat de la commande.
    const refreshed = await tx.purchaseOrderLine.findMany({
      where: { orderId },
      select: { quantity: true, receivedQuantity: true },
    });
    const fullyReceived = refreshed.every((line) => line.receivedQuantity >= line.quantity);
    const anythingReceived = refreshed.some((line) => line.receivedQuantity > 0n);

    const updated = await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status: fullyReceived ? 'RECEIVED' : anythingReceived ? 'PARTIALLY_RECEIVED' : order.status,
        // Une reception rend la dette exigible, meme si la commande etait encore
        // en brouillon : la marchandise est arrivee, elle sera a payer.
        balanceDue: order.status === 'DRAFT' ? order.total - order.paidAmount : undefined,
        locationId: locationId ?? undefined,
      },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'STOCK_MOVE',
      entityType: 'PurchaseOrder',
      entityId: orderId,
      summary: `Reception sur la commande ${order.number}`,
      metadata: { lines: receipts.length },
    });

    return updated;
  });
}

/**
 * Recalcule `paidAmount` et `balanceDue` a partir des reglements enregistres.
 * Meme principe que pour les factures : jamais d'incrementation a l'aveugle.
 */
export async function refreshOrderBalance(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { total: true, status: true },
  });

  const aggregate = await tx.payment.aggregate({
    where: { orderId },
    _sum: { amount: true },
  });
  const paid = aggregate._sum.amount ?? 0n;

  await tx.purchaseOrder.update({
    where: { id: orderId },
    data: {
      paidAmount: paid,
      balanceDue:
        order.status === 'CANCELLED' || order.status === 'DRAFT'
          ? 0n
          : balanceDue(order.total, paid),
    },
  });

  return { paid, balance: balanceDue(order.total, paid) };
}

export async function cancelPurchaseOrder(
  context: PurchaseContext,
  orderId: string,
  reason: string,
) {
  if (!reason.trim()) throw new ValidationError("Indiquez le motif de l'annulation.");

  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, companyId: context.companyId },
    include: { lines: { include: { product: true } } },
  });
  if (!order) throw new NotFoundError('Commande introuvable.');
  if (order.status === 'CANCELLED') throw new ConflictError('Cette commande est deja annulee.');

  return prisma.$transaction(async (tx) => {
    // La marchandise deja receptionnee ressort du stock : annuler une commande
    // dont le contenu est reste en rayon donnerait un stock imaginaire.
    if (order.locationId) {
      for (const line of order.lines) {
        if (!line.product?.trackStock || line.receivedQuantity <= 0n) continue;
        await applyMovement(tx, {
          companyId: context.companyId,
          productId: line.productId as string,
          locationId: order.locationId,
          kind: 'OUT',
          delta: -line.receivedQuantity,
          reason: `Annulation commande ${order.number}`,
          reference: order.number,
          userId: context.userId,
          // Le stock a pu etre vendu entre-temps : on constate malgre tout la
          // sortie, quitte a passer en negatif, plutot que de bloquer une
          // annulation legitime. L'ecart apparaitra a l'inventaire.
          allowNegative: true,
        });
      }
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        balanceDue: 0n,
      },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CANCEL',
      entityType: 'PurchaseOrder',
      entityId: orderId,
      summary: `Commande ${order.number} annulee : ${reason}`,
    });

    return updated;
  });
}

export async function getPurchaseOrder(companyId: string, orderId: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, companyId },
    include: {
      lines: {
        orderBy: { position: 'asc' },
        include: { product: { select: { sku: true, unit: { select: { symbol: true } } } } },
      },
      supplier: true,
      location: { select: { id: true, name: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: { method: { select: { name: true } } },
      },
      user: { select: { fullName: true } },
    },
  });
  if (!order) throw new NotFoundError('Commande introuvable.');
  return order;
}

export interface PurchaseListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  supplierId?: string;
  unpaidOnly?: boolean;
}

export async function listPurchaseOrders(companyId: string, query: PurchaseListQuery) {
  const search = query.search?.trim();
  const where: Prisma.PurchaseOrderWhereInput = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.unpaidOnly
      ? { balanceDue: { gt: 0n }, status: { notIn: ['CANCELLED', 'DRAFT'] } }
      : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
            { supplier: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, items, aggregate] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        location: { select: { name: true } },
      },
      orderBy: { orderDate: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.purchaseOrder.aggregate({
      where,
      _sum: { total: true, paidAmount: true, balanceDue: true },
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items,
    sums: {
      total: aggregate._sum.total ?? 0n,
      paid: aggregate._sum.paidAmount ?? 0n,
      balance: aggregate._sum.balanceDue ?? 0n,
    },
  };
}

/** Dettes fournisseur, fournisseur par fournisseur. */
export async function payablesBySupplier(companyId: string) {
  const rows = await prisma.purchaseOrder.groupBy({
    by: ['supplierId'],
    where: { companyId, status: { notIn: ['CANCELLED', 'DRAFT'] }, balanceDue: { gt: 0n } },
    _sum: { balanceDue: true },
    _count: { _all: true },
  });

  const supplierIds = rows.map((row) => row.supplierId).filter(Boolean) as string[];
  const suppliers = supplierIds.length
    ? await prisma.partner.findMany({
        where: { id: { in: supplierIds }, companyId },
        select: { id: true, name: true, code: true, phone: true },
      })
    : [];
  const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  return rows
    .map((row) => ({
      supplierId: row.supplierId,
      supplier: row.supplierId ? (byId.get(row.supplierId) ?? null) : null,
      orderCount: row._count._all,
      outstanding: row._sum.balanceDue ?? 0n,
    }))
    .sort((a, b) => (b.outstanding > a.outstanding ? 1 : b.outstanding < a.outstanding ? -1 : 0));
}
