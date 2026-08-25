import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { nextDocumentNumber } from '@/server/sequences';
import { applyMovement } from '@/server/services/stock';
import { balanceDue, computeTotals, type LineInput } from '@/lib/totals';
import { multiplyByQuantity } from '@/lib/money';

/**
 * Factures.
 *
 * La facture est le **document de creance unique** de GestiOne : une vente au
 * comptoir en produit une (`origin = "POS"`), un devis accepte se convertit en
 * une. Il n'existe donc qu'un seul endroit ou se calcule ce que les clients
 * doivent. Deux tables de creances finiraient toujours par diverger, et le
 * chiffre presente au dirigeant serait faux.
 *
 * `paidAmount` et `balanceDue` sont recalcules a partir des paiements dans la
 * meme transaction que chaque encaissement : ils ne sont jamais incrementes a
 * l'aveugle.
 */

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émise',
  PARTIALLY_PAID: 'Partiellement payée',
  PAID: 'Payée',
  CANCELLED: 'Annulée',
};

export interface InvoiceLineInput {
  productId?: string;
  description?: string;
  quantity: bigint;
  unitPrice?: bigint;
  discountRate?: number;
  taxRateId?: string;
}

export interface CreateInvoiceInput {
  customerId?: string;
  locationId?: string;
  issueDate?: Date;
  dueDate?: Date;
  lines: InvoiceLineInput[];
  discountAmount?: bigint;
  discountRate?: number;
  notes?: string;
  terms?: string;
  /** Emettre immediatement : sort le stock et rend la facture exigible. */
  issue?: boolean;
  origin?: 'INVOICE' | 'POS';
}

export interface ServiceContext {
  companyId: string;
  userId: string;
  invoicePrefix: string;
  defaultDueDays: number;
}

interface ResolvedLine {
  input: InvoiceLineInput;
  product: {
    id: string;
    name: string;
    sku: string;
    salePrice: bigint;
    costPrice: bigint;
    trackStock: boolean;
  } | null;
  description: string;
  unitPrice: bigint;
  taxRate: number;
  taxRateId: string | null;
}

/**
 * Charge et valide les lignes : articles, prix et taux de taxe doivent tous
 * appartenir a l'entreprise. Une ligne peut etre libre (sans article), ce qui
 * permet de facturer une prestation ponctuelle.
 */
async function resolveLines(
  companyId: string,
  lines: readonly InvoiceLineInput[],
): Promise<ResolvedLine[]> {
  if (lines.length === 0) {
    throw new ValidationError('Un document doit comporter au moins une ligne.');
  }

  const productIds = [...new Set(lines.map((line) => line.productId).filter(Boolean))] as string[];
  const taxRateIds = [...new Set(lines.map((line) => line.taxRateId).filter(Boolean))] as string[];

  const [products, taxRates] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, companyId },
          select: {
            id: true,
            name: true,
            sku: true,
            salePrice: true,
            costPrice: true,
            trackStock: true,
            isActive: true,
          },
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
      throw new ValidationError(`Ligne ${position} : la quantité doit être supérieure à zéro.`);
    }

    let product: ResolvedLine['product'] = null;
    if (line.productId) {
      const found = productById.get(line.productId);
      if (!found) throw new NotFoundError(`Ligne ${position} : article introuvable.`);
      if (!found.isActive) {
        throw new ValidationError(
          `Ligne ${position} : "${found.name}" ne fait plus partie du catalogue actif.`,
        );
      }
      product = found;
    }

    const description = line.description?.trim() || product?.name;
    if (!description) {
      throw new ValidationError(`Ligne ${position} : indiquez une désignation.`);
    }

    // Le prix saisi prime (remise negociee au comptoir) ; a defaut on prend le
    // prix de vente de l'article.
    const unitPrice = line.unitPrice ?? product?.salePrice;
    if (unitPrice === undefined) {
      throw new ValidationError(`Ligne ${position} : indiquez un prix unitaire.`);
    }
    if (unitPrice < 0n) {
      throw new ValidationError(`Ligne ${position} : le prix unitaire ne peut pas être négatif.`);
    }

    let taxRate = 0;
    let taxRateId: string | null = null;
    if (line.taxRateId) {
      const tax = taxById.get(line.taxRateId);
      if (!tax) throw new NotFoundError(`Ligne ${position} : taux de taxe introuvable.`);
      taxRate = tax.rate;
      taxRateId = tax.id;
    }

    return { input: line, product, description, unitPrice, taxRate, taxRateId };
  });
}

async function assertCustomer(companyId: string, customerId: string) {
  const customer = await prisma.partner.findFirst({
    where: { id: customerId, companyId, kind: 'CUSTOMER' },
    select: { id: true, name: true, creditLimit: true },
  });
  if (!customer) throw new NotFoundError('Client introuvable.');
  return customer;
}

async function assertLocation(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, companyId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');
  return location;
}

export async function createInvoice(context: ServiceContext, input: CreateInvoiceInput) {
  const resolved = await resolveLines(context.companyId, input.lines);

  if (input.customerId) await assertCustomer(context.companyId, input.customerId);
  if (input.locationId) await assertLocation(context.companyId, input.locationId);

  const issue = input.issue ?? false;
  if (issue && !input.locationId && resolved.some((line) => line.product?.trackStock)) {
    throw new ValidationError(
      'Précisez le point de vente : les articles suivis en stock doivent en sortir de quelque part.',
    );
  }

  const totalsInput: LineInput[] = resolved.map((line) => ({
    quantity: line.input.quantity,
    unitPrice: line.unitPrice,
    discountRate: line.input.discountRate ?? 0,
    taxRate: line.taxRate,
  }));

  const totals = computeTotals(totalsInput, {
    amount: input.discountAmount,
    rate: input.discountRate,
  });

  const issueDate = input.issueDate ?? new Date();
  const dueDate =
    input.dueDate ??
    new Date(issueDate.getTime() + context.defaultDueDays * 24 * 60 * 60 * 1000);

  const costTotal = resolved.reduce(
    (sum, line) => sum + multiplyByQuantity(line.product?.costPrice ?? 0n, line.input.quantity),
    0n,
  );

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, context.companyId, 'INVOICE', {
      prefix: context.invoicePrefix,
      now: issueDate,
    });

    const invoice = await tx.invoice.create({
      data: {
        companyId: context.companyId,
        number,
        customerId: input.customerId ?? null,
        locationId: input.locationId ?? null,
        origin: input.origin ?? 'INVOICE',
        status: issue ? 'ISSUED' : 'DRAFT',
        issueDate,
        dueDate,
        subtotal: totals.subtotal,
        discountAmount: totals.discountTotal,
        discountRate: input.discountRate ?? null,
        taxTotal: totals.taxTotal,
        total: totals.total,
        paidAmount: 0n,
        balanceDue: issue ? totals.total : 0n,
        costTotal,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        userId: context.userId,
        lines: {
          create: resolved.map((line, index) => ({
            productId: line.product?.id ?? null,
            description: line.description,
            quantity: line.input.quantity,
            unitPrice: line.unitPrice,
            discountRate: line.input.discountRate ?? 0,
            taxRateId: line.taxRateId,
            taxRate: line.taxRate,
            taxable: totals.lines[index]!.taxable,
            taxAmount: totals.lines[index]!.tax,
            lineTotal: totals.lines[index]!.total,
            unitCost: line.product?.costPrice ?? 0n,
            position: index + 1,
          })),
        },
      },
      include: { lines: true },
    });

    if (issue) {
      await releaseStock(tx, context, invoice.id, input.locationId ?? null, resolved, number);
    }

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CREATE',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Facture ${number} créée (${issue ? 'emise' : 'brouillon'})`,
      metadata: { total: totals.total.toString() },
    });

    return invoice;
  });
}

/** Sort du stock les articles suivis d'une facture emise. */
async function releaseStock(
  tx: Prisma.TransactionClient,
  context: ServiceContext,
  invoiceId: string,
  locationId: string | null,
  resolved: readonly ResolvedLine[],
  reference: string,
) {
  for (const line of resolved) {
    if (!line.product?.trackStock || !locationId) continue;

    await applyMovement(tx, {
      companyId: context.companyId,
      productId: line.product.id,
      locationId,
      kind: 'OUT',
      delta: -line.input.quantity,
      reason: `Vente ${reference}`,
      reference,
      userId: context.userId,
    });
  }
  return invoiceId;
}

/**
 * Emet une facture jusque-la en brouillon : elle devient exigible et le stock
 * sort. Une facture deja emise ne peut pas l'etre deux fois — le stock
 * sortirait en double.
 */
export async function issueInvoice(context: ServiceContext, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: context.companyId },
    include: { lines: { include: { product: true } } },
  });
  if (!invoice) throw new NotFoundError('Facture introuvable.');
  if (invoice.status !== 'DRAFT') {
    throw new ConflictError(`Cette facture est déjà ${INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus].toLowerCase()}.`);
  }

  const tracked = invoice.lines.filter((line) => line.product?.trackStock);
  if (tracked.length > 0 && !invoice.locationId) {
    throw new ValidationError(
      'Précisez le point de vente de la facture avant de l émettre : les articles suivis en stock doivent en sortir.',
    );
  }

  return prisma.$transaction(async (tx) => {
    for (const line of tracked) {
      await applyMovement(tx, {
        companyId: context.companyId,
        productId: line.productId as string,
        locationId: invoice.locationId as string,
        kind: 'OUT',
        delta: -line.quantity,
        reason: `Vente ${invoice.number}`,
        reference: invoice.number,
        userId: context.userId,
      });
    }

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'ISSUED', balanceDue: invoice.total },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'UPDATE',
      entityType: 'Invoice',
      entityId: invoiceId,
      summary: `Facture ${invoice.number} émise`,
    });

    return updated;
  });
}

/**
 * Annule une facture : le stock sorti est **rendu** par des mouvements
 * inverses, et les paiements deja recus sont conserves — les rembourser est une
 * decision commerciale, pas une consequence automatique de l'annulation.
 */
export async function cancelInvoice(
  context: ServiceContext,
  invoiceId: string,
  reason: string,
) {
  if (!reason.trim()) throw new ValidationError("Indiquez le motif de l'annulation.");

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: context.companyId },
    include: { lines: { include: { product: true } } },
  });
  if (!invoice) throw new NotFoundError('Facture introuvable.');
  if (invoice.status === 'CANCELLED') {
    throw new ConflictError('Cette facture est déjà annulée.');
  }

  return prisma.$transaction(async (tx) => {
    if (invoice.status !== 'DRAFT' && invoice.locationId) {
      for (const line of invoice.lines) {
        if (!line.product?.trackStock) continue;
        await applyMovement(tx, {
          companyId: context.companyId,
          productId: line.productId as string,
          locationId: invoice.locationId,
          kind: 'IN',
          delta: line.quantity,
          reason: `Annulation facture ${invoice.number}`,
          reference: invoice.number,
          userId: context.userId,
        });
      }
    }

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
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
      entityType: 'Invoice',
      entityId: invoiceId,
      summary: `Facture ${invoice.number} annulée : ${reason}`,
      metadata: { total: invoice.total.toString(), paid: invoice.paidAmount.toString() },
    });

    return updated;
  });
}

/**
 * Recalcule `paidAmount` et `balanceDue` **a partir des paiements enregistres**.
 *
 * Incrementer un compteur a chaque encaissement laisserait deriver le solde des
 * qu'un paiement est supprime ou saisi deux fois. Ici, le solde est toujours la
 * consequence de ce qui est reellement en base.
 */
export async function refreshInvoiceBalance(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<{ total: bigint; paid: bigint; balance: bigint; status: InvoiceStatus }> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { total: true, status: true },
  });

  const aggregate = await tx.payment.aggregate({
    where: { invoiceId },
    _sum: { amount: true },
  });
  const paid = aggregate._sum.amount ?? 0n;
  const balance = balanceDue(invoice.total, paid);

  // Une facture annulee le reste : un encaissement ne la ressuscite pas.
  let status = invoice.status as InvoiceStatus;
  if (status !== 'CANCELLED' && status !== 'DRAFT') {
    status = paid <= 0n ? 'ISSUED' : balance === 0n ? 'PAID' : 'PARTIALLY_PAID';
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount: paid, balanceDue: status === 'CANCELLED' ? 0n : balance, status },
  });

  return { total: invoice.total, paid, balance, status };
}

export async function getInvoice(companyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      lines: { orderBy: { position: 'asc' }, include: { product: { select: { sku: true, unit: { select: { symbol: true } } } } } },
      customer: true,
      location: { select: { name: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: { method: { select: { name: true } }, user: { select: { fullName: true } } },
      },
      user: { select: { fullName: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Facture introuvable.');
  return invoice;
}

export interface InvoiceListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  customerId?: string;
  /** Ne remonter que les factures dont le solde est encore du. */
  unpaidOnly?: boolean;
  /** Ne remonter que les factures echues et non soldees. */
  overdueOnly?: boolean;
}

export async function listInvoices(companyId: string, query: InvoiceListQuery) {
  const search = query.search?.trim();
  // Le filtre "impayees" porte lui aussi sur le statut : il doit se combiner
  // avec un statut choisi par l'utilisateur, jamais l'ecraser. Sans le AND,
  // "Emise + impayees" renvoyait silencieusement toutes les factures impayees.
  const where: Prisma.InvoiceWhereInput = {
    companyId,
    ...(query.customerId ? { customerId: query.customerId } : {}),
    AND: [
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.unpaidOnly || query.overdueOnly
        ? [{ balanceDue: { gt: 0n }, status: { notIn: ['CANCELLED', 'DRAFT'] } }]
        : []),
    ],
    ...(query.overdueOnly ? { dueDate: { lt: new Date() } } : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
            { customer: { code: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, items, aggregate] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        location: { select: { name: true } },
      },
      orderBy: { issueDate: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.invoice.aggregate({ where, _sum: { total: true, paidAmount: true, balanceDue: true } }),
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

/**
 * Une facture est "en retard" quand elle est echue et non soldee. Le statut
 * n'est pas stocke : il se deduit de la date et du solde, ce qui evite d'avoir
 * a faire tourner une tache qui basculerait les factures chaque nuit — et qui
 * afficherait un statut faux si elle ne tournait pas.
 */
export function isOverdue(invoice: {
  status: string;
  dueDate: Date | null;
  balanceDue: bigint;
}): boolean {
  if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') return false;
  if (invoice.balanceDue <= 0n) return false;
  if (!invoice.dueDate) return false;
  return invoice.dueDate.getTime() < Date.now();
}
