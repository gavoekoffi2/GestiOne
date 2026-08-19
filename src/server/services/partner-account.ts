import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { getPartner } from '@/server/services/partners';
import type { PartnerKind } from '@/lib/validation/catalog';

/**
 * Compte d'un partenaire : tout ce qui s'est passe avec lui, et ce qu'il reste
 * a regler de part et d'autre.
 *
 * C'est la question que se pose un commercant plusieurs fois par jour — « ce
 * client, il me doit combien, et depuis quand ? ». Y repondre supposait
 * jusqu'ici de filtrer la liste des factures, puis celle des paiements, puis de
 * faire l'addition de tete.
 *
 * **Aucun solde n'est stocke ici.** Les montants sont agreges a la lecture, a
 * partir des documents eux-memes (`Invoice.balanceDue`, `PurchaseOrder.balanceDue`).
 * Un compteur de dette tenu a part finirait par diverger du jour ou une facture
 * serait annulee sans que la mise a jour suive — et le dirigeant reclamerait de
 * l'argent deja recu.
 *
 * **Les totaux portent sur tout l'historique, la liste sur les derniers
 * documents.** Les deux sont calcules separement, et c'est volontaire : un
 * client fidele depasse vite cinquante factures, et un releve dont le total ne
 * serait que celui de la page affichee serait faux sans en avoir l'air.
 */

/** Nombre de documents listes sur la fiche : de quoi couvrir plusieurs mois. */
const DOCUMENT_LIMIT = 50;

export interface PartnerAccountDocument {
  id: string;
  number: string;
  date: Date;
  dueDate: Date | null;
  status: string;
  total: bigint;
  paidAmount: bigint;
  balanceDue: bigint;
  origin?: string;
}

export interface PartnerAccountPayment {
  id: string;
  number: string;
  paidAt: Date;
  amount: bigint;
  methodName: string | null;
  reference: string | null;
  documentNumber: string | null;
}

export interface PartnerAccount {
  partner: Awaited<ReturnType<typeof getPartner>>;
  /** Total facture (client) ou commande (fournisseur), annulations exclues. */
  billed: bigint;
  /** Total deja regle sur ces documents. */
  settled: bigint;
  /** Reste du, somme des soldes des documents ouverts. */
  outstanding: bigint;
  /** Reglements sans document rattache : acomptes cote client, avances cote fournisseur. */
  unallocated: bigint;
  /** Encours net : ce qui est du, acomptes deduits. Jamais negatif. */
  netOutstanding: bigint;
  /** Nombre total de documents, y compris ceux qui ne sont pas listes. */
  documentCount: number;
  overdueCount: number;
  overdueAmount: bigint;
  /** Part du plafond de credit consommee, en pourcentage. `null` si aucun plafond. */
  creditUsagePercent: number | null;
  /** Les derniers documents, du plus recent au plus ancien. */
  documents: PartnerAccountDocument[];
  /** Vrai si l'historique compte plus de documents que la liste n'en montre. */
  documentsTruncated: boolean;
  payments: PartnerAccountPayment[];
  paymentsTruncated: boolean;
  firstDocumentAt: Date | null;
  lastDocumentAt: Date | null;
}

export async function getPartnerAccount(
  companyId: string,
  kind: PartnerKind,
  partnerId: string,
  now: Date = new Date(),
): Promise<PartnerAccount> {
  const partner = await getPartner(companyId, kind, partnerId);

  const side =
    kind === 'CUSTOMER'
      ? await loadCustomerSide(companyId, partnerId, now)
      : await loadSupplierSide(companyId, partnerId, now);

  const netOutstanding =
    side.outstanding - side.unallocated > 0n ? side.outstanding - side.unallocated : 0n;

  return {
    partner,
    billed: side.billed,
    settled: side.settled,
    outstanding: side.outstanding,
    unallocated: side.unallocated,
    netOutstanding,
    documentCount: side.documentCount,
    overdueCount: side.overdueCount,
    overdueAmount: side.overdueAmount,
    creditUsagePercent:
      partner.creditLimit > 0n ? Number((netOutstanding * 100n) / partner.creditLimit) : null,
    documents: side.documents,
    documentsTruncated: side.documentCount > side.documents.length,
    payments: side.payments,
    paymentsTruncated: side.paymentCount > side.payments.length,
    firstDocumentAt: side.firstDocumentAt,
    lastDocumentAt: side.lastDocumentAt,
  };
}

/**
 * Cote client : les factures.
 *
 * Les brouillons sont exclus. Une facture non emise n'engage personne : la
 * faire figurer sur un releve reviendrait a reclamer une somme pour laquelle le
 * client n'a jamais recu de facture.
 */
async function loadCustomerSide(companyId: string, partnerId: string, now: Date) {
  const scope: Prisma.InvoiceWhereInput = {
    companyId,
    customerId: partnerId,
    status: { notIn: ['CANCELLED', 'DRAFT'] },
  };

  const [totals, span, overdue, invoices, advances, payments, paymentCount] = await Promise.all([
    prisma.invoice.aggregate({
      where: scope,
      _sum: { total: true, paidAmount: true, balanceDue: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({ where: scope, _min: { issueDate: true }, _max: { issueDate: true } }),
    prisma.invoice.aggregate({
      where: { ...scope, balanceDue: { gt: 0n }, dueDate: { lt: now } },
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
    prisma.invoice.findMany({
      where: scope,
      orderBy: { issueDate: 'desc' },
      take: DOCUMENT_LIMIT,
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        status: true,
        origin: true,
        total: true,
        paidAmount: true,
        balanceDue: true,
      },
    }),
    // Acomptes encaisses sans facture : ils reduisent la dette reelle du client.
    prisma.payment.aggregate({
      where: { companyId, partnerId, direction: 'IN', invoiceId: null },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: { companyId, partnerId, direction: 'IN' },
      orderBy: { paidAt: 'desc' },
      take: DOCUMENT_LIMIT,
      select: {
        id: true,
        number: true,
        paidAt: true,
        amount: true,
        reference: true,
        method: { select: { name: true } },
        invoice: { select: { number: true } },
      },
    }),
    prisma.payment.count({ where: { companyId, partnerId, direction: 'IN' } }),
  ]);

  return {
    billed: totals._sum.total ?? 0n,
    settled: totals._sum.paidAmount ?? 0n,
    outstanding: totals._sum.balanceDue ?? 0n,
    documentCount: totals._count._all,
    overdueCount: overdue._count._all,
    overdueAmount: overdue._sum.balanceDue ?? 0n,
    unallocated: advances._sum.amount ?? 0n,
    firstDocumentAt: span._min.issueDate,
    lastDocumentAt: span._max.issueDate,
    paymentCount,
    documents: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      date: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      origin: invoice.origin,
      total: invoice.total,
      paidAmount: invoice.paidAmount,
      balanceDue: invoice.balanceDue,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      number: payment.number,
      paidAt: payment.paidAt,
      amount: payment.amount,
      methodName: payment.method?.name ?? null,
      reference: payment.reference,
      documentNumber: payment.invoice?.number ?? null,
    })),
  };
}

/**
 * Cote fournisseur : les commandes.
 *
 * Meme regle qu'en face : une commande encore en brouillon n'a pas ete passee,
 * elle ne represente donc aucune dette.
 */
async function loadSupplierSide(companyId: string, partnerId: string, now: Date) {
  const scope: Prisma.PurchaseOrderWhereInput = {
    companyId,
    supplierId: partnerId,
    status: { notIn: ['CANCELLED', 'DRAFT'] },
  };

  const [totals, span, overdue, orders, advances, payments, paymentCount] = await Promise.all([
    prisma.purchaseOrder.aggregate({
      where: scope,
      _sum: { total: true, paidAmount: true, balanceDue: true },
      _count: { _all: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: scope,
      _min: { orderDate: true },
      _max: { orderDate: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { ...scope, balanceDue: { gt: 0n }, dueDate: { lt: now } },
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
    prisma.purchaseOrder.findMany({
      where: scope,
      orderBy: { orderDate: 'desc' },
      take: DOCUMENT_LIMIT,
      select: {
        id: true,
        number: true,
        orderDate: true,
        dueDate: true,
        status: true,
        total: true,
        paidAmount: true,
        balanceDue: true,
      },
    }),
    prisma.payment.aggregate({
      where: { companyId, partnerId, direction: 'OUT', orderId: null },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: { companyId, partnerId, direction: 'OUT' },
      orderBy: { paidAt: 'desc' },
      take: DOCUMENT_LIMIT,
      select: {
        id: true,
        number: true,
        paidAt: true,
        amount: true,
        reference: true,
        method: { select: { name: true } },
        order: { select: { number: true } },
      },
    }),
    prisma.payment.count({ where: { companyId, partnerId, direction: 'OUT' } }),
  ]);

  return {
    billed: totals._sum.total ?? 0n,
    settled: totals._sum.paidAmount ?? 0n,
    outstanding: totals._sum.balanceDue ?? 0n,
    documentCount: totals._count._all,
    overdueCount: overdue._count._all,
    overdueAmount: overdue._sum.balanceDue ?? 0n,
    unallocated: advances._sum.amount ?? 0n,
    firstDocumentAt: span._min.orderDate,
    lastDocumentAt: span._max.orderDate,
    paymentCount,
    documents: orders.map((order) => ({
      id: order.id,
      number: order.number,
      date: order.orderDate,
      dueDate: order.dueDate,
      status: order.status,
      total: order.total,
      paidAmount: order.paidAmount,
      balanceDue: order.balanceDue,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      number: payment.number,
      paidAt: payment.paidAt,
      amount: payment.amount,
      methodName: payment.method?.name ?? null,
      reference: payment.reference,
      documentNumber: payment.order?.number ?? null,
    })),
  };
}
