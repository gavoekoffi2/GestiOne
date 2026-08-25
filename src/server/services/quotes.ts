import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { nextDocumentNumber } from '@/server/sequences';
import { computeTotals, type LineInput } from '@/lib/totals';
import { createInvoice, type ServiceContext } from '@/server/services/invoices';

/**
 * Devis.
 *
 * Un devis n'engage aucun stock et ne cree aucune creance : c'est une
 * proposition. Il devient un engagement uniquement lors de sa conversion en
 * facture, qui est le seul moment ou le stock sort et ou la creance nait.
 */

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Brouillon',
  SENT: 'Envoye',
  ACCEPTED: 'Accepté',
  REJECTED: 'Refuse',
  EXPIRED: 'Expiré',
  CONVERTED: 'Converti en facture',
};

/**
 * Transitions autorisees. Les interdire explicitement evite qu'un devis deja
 * converti soit "refuse" a posteriori alors qu'une facture existe.
 */
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'DRAFT'],
  ACCEPTED: ['REJECTED', 'CONVERTED'],
  REJECTED: ['SENT'],
  EXPIRED: ['SENT'],
  CONVERTED: [],
};

/** Transitions ouvertes depuis un statut donne, hors conversion. */
export function allowedTransitions(status: string): QuoteStatus[] {
  return ALLOWED_TRANSITIONS[status as QuoteStatus] ?? [];
}

/** Un devis est convertible s'il n'est ni deja converti, ni refuse, ni expire. */
export function canConvert(quote: { status: string; invoiceId: string | null }): boolean {
  return !quote.invoiceId && !['CONVERTED', 'REJECTED', 'EXPIRED'].includes(quote.status);
}

export interface QuoteLineInput {
  productId?: string;
  description?: string;
  quantity: bigint;
  unitPrice?: bigint;
  discountRate?: number;
  taxRateId?: string;
}

export interface QuoteInput {
  customerId?: string;
  locationId?: string;
  issueDate?: Date;
  validUntil?: Date;
  lines: QuoteLineInput[];
  discountAmount?: bigint;
  discountRate?: number;
  notes?: string;
  terms?: string;
}

export interface QuoteContext extends ServiceContext {
  quotePrefix: string;
}

interface ResolvedQuoteLine {
  input: QuoteLineInput;
  productId: string | null;
  description: string;
  unitPrice: bigint;
  taxRate: number;
  taxRateId: string | null;
}

async function resolveQuoteLines(
  companyId: string,
  lines: readonly QuoteLineInput[],
): Promise<ResolvedQuoteLine[]> {
  if (lines.length === 0) {
    throw new ValidationError('Un devis doit comporter au moins une ligne.');
  }

  const productIds = [...new Set(lines.map((line) => line.productId).filter(Boolean))] as string[];
  const taxRateIds = [...new Set(lines.map((line) => line.taxRateId).filter(Boolean))] as string[];

  const [products, taxRates] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, companyId },
          select: { id: true, name: true, salePrice: true, isActive: true },
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

    let product: { id: string; name: string; salePrice: bigint } | null = null;
    if (line.productId) {
      const found = productById.get(line.productId);
      if (!found) throw new NotFoundError(`Ligne ${position} : article introuvable.`);
      product = found;
    }

    const description = line.description?.trim() || product?.name;
    if (!description) throw new ValidationError(`Ligne ${position} : indiquez une désignation.`);

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

    return { input: line, productId: product?.id ?? null, description, unitPrice, taxRate, taxRateId };
  });
}

export async function createQuote(context: QuoteContext, input: QuoteInput) {
  const resolved = await resolveQuoteLines(context.companyId, input.lines);

  if (input.customerId) {
    const customer = await prisma.partner.findFirst({
      where: { id: input.customerId, companyId: context.companyId, kind: 'CUSTOMER' },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError('Client introuvable.');
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

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, context.companyId, 'QUOTE', {
      prefix: context.quotePrefix,
      now: issueDate,
    });

    const quote = await tx.quote.create({
      data: {
        companyId: context.companyId,
        number,
        customerId: input.customerId ?? null,
        locationId: input.locationId ?? null,
        status: 'DRAFT',
        issueDate,
        validUntil: input.validUntil ?? null,
        subtotal: totals.subtotal,
        discountAmount: totals.discountTotal,
        discountRate: input.discountRate ?? null,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        userId: context.userId,
        lines: {
          create: resolved.map((line, index) => ({
            productId: line.productId,
            description: line.description,
            quantity: line.input.quantity,
            unitPrice: line.unitPrice,
            discountRate: line.input.discountRate ?? 0,
            taxRateId: line.taxRateId,
            taxRate: line.taxRate,
            lineTotal: totals.lines[index]!.total,
            position: index + 1,
          })),
        },
      },
      include: { lines: true },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CREATE',
      entityType: 'Quote',
      entityId: quote.id,
      summary: `Devis ${number} créé`,
      metadata: { total: totals.total.toString() },
    });

    return quote;
  });
}

export async function getQuote(companyId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, companyId },
    include: {
      lines: {
        orderBy: { position: 'asc' },
        include: { product: { select: { sku: true, unit: { select: { symbol: true } } } } },
      },
      customer: true,
      invoice: { select: { id: true, number: true } },
      user: { select: { fullName: true } },
    },
  });
  if (!quote) throw new NotFoundError('Devis introuvable.');
  return quote;
}

export async function changeQuoteStatus(
  context: QuoteContext,
  quoteId: string,
  target: QuoteStatus,
) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, companyId: context.companyId },
    select: { id: true, number: true, status: true },
  });
  if (!quote) throw new NotFoundError('Devis introuvable.');

  const current = quote.status as QuoteStatus;
  if (target === 'CONVERTED') {
    throw new ValidationError(
      'La conversion se fait en créant la facture, pas en changeant le statut.',
    );
  }
  if (!ALLOWED_TRANSITIONS[current].includes(target)) {
    throw new ConflictError(
      `Un devis ${QUOTE_STATUS_LABELS[current].toLowerCase()} ne peut pas passer a "${QUOTE_STATUS_LABELS[target].toLowerCase()}".`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.quote.update({ where: { id: quoteId }, data: { status: target } });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'UPDATE',
      entityType: 'Quote',
      entityId: quoteId,
      summary: `Devis ${quote.number} : ${QUOTE_STATUS_LABELS[target]}`,
    });

    return updated;
  });
}

/**
 * Convertit un devis accepte en facture.
 *
 * Le devis est fige : il passe a CONVERTED et pointe vers la facture creee. Une
 * seconde conversion est refusee, sans quoi le stock sortirait deux fois et le
 * client serait facture en double.
 */
export async function convertQuoteToInvoice(
  context: QuoteContext,
  quoteId: string,
  options: { issue?: boolean; locationId?: string; dueDate?: Date } = {},
) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, companyId: context.companyId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!quote) throw new NotFoundError('Devis introuvable.');

  if (quote.status === 'CONVERTED' || quote.invoiceId) {
    throw new ConflictError(`Le devis ${quote.number} a déjà été converti en facture.`);
  }
  if (quote.status === 'REJECTED' || quote.status === 'EXPIRED') {
    throw new ConflictError(
      `Le devis ${quote.number} est ${QUOTE_STATUS_LABELS[quote.status as QuoteStatus].toLowerCase()} : réactivez-le avant de le convertir.`,
    );
  }

  const invoice = await createInvoice(context, {
    customerId: quote.customerId ?? undefined,
    locationId: options.locationId ?? quote.locationId ?? undefined,
    dueDate: options.dueDate,
    issue: options.issue ?? false,
    notes: quote.notes ?? undefined,
    terms: quote.terms ?? undefined,
    // La remise globale est reprise telle qu'elle a ete accordee au client :
    // en montant, pour que le total de la facture soit identique a celui du
    // devis meme si les prix du catalogue ont change entre-temps.
    discountAmount: quote.discountAmount > 0n ? quote.discountAmount : undefined,
    lines: quote.lines.map((line) => ({
      productId: line.productId ?? undefined,
      description: line.description,
      quantity: line.quantity,
      // Le prix accepte par le client prime sur le prix courant du catalogue.
      unitPrice: line.unitPrice,
      discountRate: line.discountRate,
      taxRateId: line.taxRateId ?? undefined,
    })),
  });

  await prisma.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'CONVERTED', invoiceId: invoice.id },
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'UPDATE',
      entityType: 'Quote',
      entityId: quoteId,
      summary: `Devis ${quote.number} converti en facture ${invoice.number}`,
    });
  });

  return invoice;
}

export interface QuoteListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  customerId?: string;
}

export async function listQuotes(companyId: string, query: QuoteListQuery) {
  const search = query.search?.trim();
  const where: Prisma.QuoteWhereInput = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true } },
      },
      orderBy: { issueDate: 'desc' },
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

/**
 * Un devis est expire quand sa date de validite est passee. Comme pour les
 * factures en retard, le statut se deduit de la date plutot que d'etre bascule
 * par une tache planifiee, qui afficherait un statut faux si elle ne tournait
 * pas.
 */
export function isExpired(quote: { status: string; validUntil: Date | null }): boolean {
  if (!['DRAFT', 'SENT'].includes(quote.status)) return false;
  if (!quote.validUntil) return false;
  return quote.validUntil.getTime() < Date.now();
}
