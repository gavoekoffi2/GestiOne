import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { nextDocumentNumber } from '@/server/sequences';
import { refreshInvoiceBalance } from '@/server/services/invoices';
import { applyCashMovement } from '@/server/services/cash';
import { refreshOrderBalance } from '@/server/services/purchases';

/**
 * Paiements.
 *
 * Un paiement peut etre un encaissement client (`IN`) ou un reglement
 * fournisseur (`OUT`). Il peut etre rattache a une facture — auquel cas le solde
 * de celle-ci est **recalcule a partir de tous ses paiements** dans la meme
 * transaction — ou rester un acompte non affecte.
 *
 * Le mode de reglement `CREDIT` n'est pas un paiement : c'est l'absence de
 * paiement. Il ne peut donc pas etre utilise ici, sans quoi une vente a credit
 * apparaitrait comme encaissee.
 */

export interface PaymentContext {
  companyId: string;
  userId: string;
  paymentPrefix: string;
}

export interface RecordPaymentInput {
  direction: 'IN' | 'OUT';
  /** Commande fournisseur reglee, pour un decaissement. */
  orderId?: string;
  amount: bigint;
  invoiceId?: string;
  partnerId?: string;
  methodId?: string;
  locationId?: string;
  paidAt?: Date;
  reference?: string;
  notes?: string;
  /** Autorise un encaissement superieur au solde restant (acompte, avance). */
  allowOverpayment?: boolean;
}

async function assertMethod(companyId: string, methodId: string) {
  const method = await prisma.paymentMethod.findFirst({
    where: { id: methodId, companyId },
    select: {
      id: true,
      name: true,
      isCredit: true,
      isActive: true,
      requiresReference: true,
      affectsCash: true,
    },
  });
  if (!method) throw new NotFoundError('Mode de reglement introuvable.');
  if (!method.isActive) {
    throw new ValidationError(`Le mode de reglement "${method.name}" est desactive.`);
  }
  if (method.isCredit) {
    throw new ValidationError(
      "\"Credit\" signifie que le client n'a pas encore paye : ce n'est pas un reglement. Laissez la facture impayee, puis enregistrez le paiement lorsqu'il arrivera.",
    );
  }
  return method;
}

export async function recordPayment(context: PaymentContext, input: RecordPaymentInput) {
  if (input.amount <= 0n) {
    throw new ValidationError('Le montant du paiement doit etre superieur a zero.');
  }

  const method = input.methodId ? await assertMethod(context.companyId, input.methodId) : null;
  if (method?.requiresReference && !input.reference?.trim()) {
    throw new ValidationError(
      `Le mode "${method.name}" exige une reference (numero de transaction, de cheque ou de bordereau).`,
    );
  }

  let invoice: { id: string; number: string; balanceDue: bigint; status: string; customerId: string | null } | null =
    null;

  if (input.invoiceId) {
    const found = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, companyId: context.companyId },
      select: { id: true, number: true, balanceDue: true, status: true, customerId: true },
    });
    if (!found) throw new NotFoundError('Facture introuvable.');
    if (found.status === 'CANCELLED') {
      throw new ConflictError(
        `La facture ${found.number} est annulee : elle ne peut plus recevoir de paiement.`,
      );
    }
    if (found.status === 'DRAFT') {
      throw new ConflictError(
        `La facture ${found.number} est encore un brouillon. Emettez-la avant d'enregistrer un paiement.`,
      );
    }
    if (!input.allowOverpayment && input.amount > found.balanceDue) {
      throw new ValidationError(
        `Le montant depasse le solde restant de la facture ${found.number}. Corrigez le montant, ou confirmez l'encaissement d'une avance.`,
      );
    }
    invoice = found;
  }

  let order: { id: string; number: string; balanceDue: bigint; status: string; supplierId: string | null } | null =
    null;

  if (input.orderId) {
    const found = await prisma.purchaseOrder.findFirst({
      where: { id: input.orderId, companyId: context.companyId },
      select: { id: true, number: true, balanceDue: true, status: true, supplierId: true },
    });
    if (!found) throw new NotFoundError('Commande fournisseur introuvable.');
    if (found.status === 'CANCELLED') {
      throw new ConflictError(
        `La commande ${found.number} est annulee : elle ne peut plus etre reglee.`,
      );
    }
    if (found.status === 'DRAFT') {
      throw new ConflictError(
        `La commande ${found.number} est encore un brouillon. Passez-la commande avant de la regler.`,
      );
    }
    if (!input.allowOverpayment && input.amount > found.balanceDue) {
      throw new ValidationError(
        `Le montant depasse le solde restant de la commande ${found.number}.`,
      );
    }
    order = found;
  }

  if (input.partnerId) {
    const expectedKind = input.direction === 'IN' ? 'CUSTOMER' : 'SUPPLIER';
    const partner = await prisma.partner.findFirst({
      where: { id: input.partnerId, companyId: context.companyId, kind: expectedKind },
      select: { id: true },
    });
    if (!partner) {
      throw new NotFoundError(
        expectedKind === 'CUSTOMER' ? 'Client introuvable.' : 'Fournisseur introuvable.',
      );
    }
  }

  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, companyId: context.companyId },
      select: { id: true },
    });
    if (!location) throw new NotFoundError('Point de vente introuvable.');
  }

  const paidAt = input.paidAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, context.companyId, 'PAYMENT', {
      prefix: context.paymentPrefix,
      now: paidAt,
    });

    const payment = await tx.payment.create({
      data: {
        companyId: context.companyId,
        number,
        direction: input.direction,
        // Un encaissement rattache a une facture herite du client de celle-ci :
        // le "qui a paye" ne doit pas dependre de ce que l'ecran a transmis.
        partnerId: input.partnerId ?? invoice?.customerId ?? order?.supplierId ?? null,
        invoiceId: invoice?.id ?? null,
        orderId: order?.id ?? null,
        methodId: input.methodId ?? null,
        locationId: input.locationId ?? null,
        amount: input.amount,
        paidAt,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        userId: context.userId,
      },
    });

    if (invoice) await refreshInvoiceBalance(tx, invoice.id);
    if (order) await refreshOrderBalance(tx, order.id);

    // Un reglement en especes alimente ou vide la caisse du point de vente.
    // Sans ce lien, le solde de caisse serait purement decoratif : il ne
    // refleterait aucune des ventes reellement encaissees.
    if (method?.affectsCash && input.locationId) {
      await applyCashMovement(tx, {
        companyId: context.companyId,
        locationId: input.locationId,
        kind: input.direction === 'IN' ? 'SALE' : 'PURCHASE',
        amount: input.direction === 'IN' ? input.amount : -input.amount,
        reason:
          input.direction === 'IN'
            ? `Encaissement ${number}${invoice ? ` — facture ${invoice.number}` : ''}`
            : `Reglement fournisseur ${number}`,
        reference: input.reference ?? null,
        paymentId: payment.id,
        userId: context.userId,
      });
    }

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'PAYMENT',
      entityType: 'Payment',
      entityId: payment.id,
      summary:
        input.direction === 'IN'
          ? `Encaissement ${number}${invoice ? ` sur facture ${invoice.number}` : ''}`
          : `Reglement fournisseur ${number}`,
      metadata: { amount: input.amount.toString(), method: method?.name ?? null },
    });

    return payment;
  });
}

/**
 * Annule un paiement.
 *
 * La ligne est supprimee plutot que marquee : le journal d'audit conserve la
 * trace de l'encaissement **et** de son annulation, ce qui suffit a la
 * tracabilite, tandis qu'un paiement annule qui resterait en base fausserait
 * toutes les sommes s'il etait oublie dans un filtre.
 */
export async function deletePayment(context: PaymentContext, paymentId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError("Indiquez le motif de l'annulation.");

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, companyId: context.companyId },
    include: {
      invoice: { select: { id: true, number: true } },
      order: { select: { id: true, number: true } },
    },
  });
  if (!payment) throw new NotFoundError('Paiement introuvable.');

  return prisma.$transaction(async (tx) => {
    // Le mouvement de caisse genere par ce paiement est neutralise par un
    // mouvement inverse plutot que supprime : le journal de caisse reste en
    // ajout seul, et le rapprochement d'une session deja fermee ne change pas
    // retroactivement.
    const cashMovements = await tx.cashMovement.findMany({
      where: { paymentId, companyId: context.companyId },
      select: { id: true, locationId: true, amount: true },
    });

    for (const movement of cashMovements) {
      await applyCashMovement(tx, {
        companyId: context.companyId,
        locationId: movement.locationId,
        kind: 'ADJUSTMENT',
        amount: -movement.amount,
        reason: `Annulation du paiement ${payment.number}`,
        userId: context.userId,
      });
    }

    await tx.payment.delete({ where: { id: paymentId } });

    if (payment.invoiceId) await refreshInvoiceBalance(tx, payment.invoiceId);
    if (payment.orderId) await refreshOrderBalance(tx, payment.orderId);

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CANCEL',
      entityType: 'Payment',
      entityId: paymentId,
      summary: `Paiement ${payment.number} annule : ${reason}`,
      metadata: {
        amount: payment.amount.toString(),
        invoice: payment.invoice?.number ?? null,
        order: payment.order?.number ?? null,
        paidAt: payment.paidAt.toISOString(),
      },
    });
  });
}

export interface PaymentListQuery {
  page: number;
  pageSize: number;
  direction?: 'IN' | 'OUT';
  partnerId?: string;
  invoiceId?: string;
  methodId?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

export async function listPayments(companyId: string, query: PaymentListQuery) {
  const search = query.search?.trim();
  const where: Prisma.PaymentWhereInput = {
    companyId,
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.partnerId ? { partnerId: query.partnerId } : {}),
    ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
    ...(query.methodId ? { methodId: query.methodId } : {}),
    ...(query.from || query.to
      ? { paidAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
            { partner: { name: { contains: search, mode: 'insensitive' } } },
            { invoice: { number: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, items, aggregate] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true, code: true } },
        invoice: { select: { id: true, number: true } },
        method: { select: { name: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { paidAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items,
    sum: aggregate._sum.amount ?? 0n,
  };
}

/**
 * Encours d'un client : ce qu'il doit encore, toutes factures confondues.
 * Se deduit des factures, jamais d'un compteur tenu a part.
 */
export async function partnerBalance(companyId: string, partnerId: string) {
  const [invoices, unallocated] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        companyId,
        customerId: partnerId,
        status: { notIn: ['CANCELLED', 'DRAFT'] },
      },
      _sum: { total: true, paidAmount: true, balanceDue: true },
    }),
    // Acomptes encaisses sans facture : ils reduisent la dette reelle du client.
    prisma.payment.aggregate({
      where: { companyId, partnerId, direction: 'IN', invoiceId: null },
      _sum: { amount: true },
    }),
  ]);

  const invoiced = invoices._sum.total ?? 0n;
  const paid = invoices._sum.paidAmount ?? 0n;
  const outstanding = invoices._sum.balanceDue ?? 0n;
  const advances = unallocated._sum.amount ?? 0n;

  return {
    invoiced,
    paid,
    outstanding,
    advances,
    /// Ce que le client doit reellement, acomptes non affectes deduits.
    netOutstanding: outstanding - advances > 0n ? outstanding - advances : 0n,
  };
}

/** Creances clients de toute l'entreprise, client par client. */
export async function receivablesByCustomer(companyId: string) {
  const rows = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: {
      companyId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      balanceDue: { gt: 0n },
    },
    _sum: { balanceDue: true },
    _count: { _all: true },
  });

  const customerIds = rows.map((row) => row.customerId).filter(Boolean) as string[];
  const customers = customerIds.length
    ? await prisma.partner.findMany({
        where: { id: { in: customerIds }, companyId },
        select: { id: true, name: true, code: true, phone: true, creditLimit: true },
      })
    : [];
  const byId = new Map(customers.map((customer) => [customer.id, customer]));

  return rows
    .map((row) => ({
      customerId: row.customerId,
      customer: row.customerId ? (byId.get(row.customerId) ?? null) : null,
      invoiceCount: row._count._all,
      outstanding: row._sum.balanceDue ?? 0n,
    }))
    .sort((a, b) => (b.outstanding > a.outstanding ? 1 : b.outstanding < a.outstanding ? -1 : 0));
}
