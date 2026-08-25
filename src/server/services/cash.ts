import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { getCurrencyFormat } from '@/server/currency';
import { formatMoney } from '@/lib/money';

/**
 * Caisse.
 *
 * Deux notions distinctes, volontairement decouplees :
 *
 *  * `CashMovement` est le journal des especes d'un point de vente, en ajout
 *    seul. Le solde de caisse est toujours la somme de ces mouvements.
 *  * `CashSession` sert au **rapprochement** : elle compare, entre une
 *    ouverture et une fermeture, ce que GestiOne a enregistre a ce que le
 *    caissier a reellement compte.
 *
 * `sessionId` est facultatif sur un mouvement. Refuser un encaissement parce
 * qu'aucune session n'est ouverte serait ingerable dans une boutique ; mais
 * ignorer cet encaissement ferait disparaitre l'argent des comptes. Il est donc
 * enregistre hors session, et l'ecran de caisse le signale.
 */

export type CashMovementKind =
  | 'OPENING'
  | 'SALE'
  | 'REFUND'
  | 'EXPENSE'
  | 'PURCHASE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';

export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = {
  OPENING: 'Fonds de caisse',
  SALE: 'Encaissement',
  REFUND: 'Remboursement',
  EXPENSE: 'Dépense',
  PURCHASE: 'Règlement fournisseur',
  DEPOSIT: 'Apport',
  WITHDRAWAL: 'Retrait',
  ADJUSTMENT: 'Ajustement',
};

export interface CashContext {
  companyId: string;
  userId: string;
}

/** Session ouverte d'un point de vente, s'il y en a une. */
export async function openSessionFor(
  tx: Prisma.TransactionClient,
  companyId: string,
  locationId: string,
): Promise<{ id: string } | null> {
  return tx.cashSession.findFirst({
    where: { companyId, locationId, status: 'OPEN' },
    select: { id: true },
    orderBy: { openedAt: 'desc' },
  });
}

/**
 * Enregistre un mouvement de caisse dans la transaction en cours et le rattache
 * a la session ouverte du point de vente, si elle existe.
 */
export async function applyCashMovement(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    locationId: string;
    kind: CashMovementKind;
    amount: bigint;
    reason?: string | null;
    reference?: string | null;
    paymentId?: string | null;
    expenseId?: string | null;
    userId?: string | null;
  },
) {
  const session = await openSessionFor(tx, input.companyId, input.locationId);

  return tx.cashMovement.create({
    data: {
      companyId: input.companyId,
      locationId: input.locationId,
      sessionId: session?.id ?? null,
      kind: input.kind,
      amount: input.amount,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      paymentId: input.paymentId ?? null,
      expenseId: input.expenseId ?? null,
      userId: input.userId ?? null,
    },
  });
}

/** Solde de caisse d'un point de vente : somme de tous ses mouvements. */
export async function cashBalance(companyId: string, locationId: string): Promise<bigint> {
  const aggregate = await prisma.cashMovement.aggregate({
    where: { companyId, locationId },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? 0n;
}

/** Solde theorique d'une session : fonds d'ouverture + mouvements rattaches. */
export async function sessionExpectedAmount(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<bigint> {
  const aggregate = await tx.cashMovement.aggregate({
    where: { sessionId },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? 0n;
}

export async function openCashSession(
  context: CashContext,
  input: { locationId: string; openingAmount: bigint },
) {
  if (input.openingAmount < 0n) {
    throw new ValidationError('Le fonds de caisse ne peut pas être négatif.');
  }

  const location = await prisma.location.findFirst({
    where: { id: input.locationId, companyId: context.companyId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');

  return prisma.$transaction(async (tx) => {
    const existing = await openSessionFor(tx, context.companyId, input.locationId);
    if (existing) {
      throw new ConflictError(
        `Une caisse est déjà ouverte pour ${location.name}. Fermez-la avant d'en ouvrir une nouvelle.`,
      );
    }

    const session = await tx.cashSession.create({
      data: {
        companyId: context.companyId,
        locationId: input.locationId,
        status: 'OPEN',
        openingAmount: input.openingAmount,
        openedById: context.userId,
      },
    });

    // Le fonds de caisse est un mouvement comme un autre : ainsi le solde reste
    // toujours la simple somme du journal, sans cas particulier a l'ouverture.
    if (input.openingAmount > 0n) {
      await tx.cashMovement.create({
        data: {
          companyId: context.companyId,
          locationId: input.locationId,
          sessionId: session.id,
          kind: 'OPENING',
          amount: input.openingAmount,
          reason: 'Fonds de caisse',
          userId: context.userId,
        },
      });
    }

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CREATE',
      entityType: 'CashSession',
      entityId: session.id,
      summary: `Caisse ouverte à ${location.name}`,
      metadata: { openingAmount: input.openingAmount.toString() },
    });

    return session;
  });
}

export async function closeCashSession(
  context: CashContext,
  sessionId: string,
  input: { countedAmount: bigint; notes?: string },
) {
  if (input.countedAmount < 0n) {
    throw new ValidationError('Le montant compté ne peut pas être négatif.');
  }

  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, companyId: context.companyId },
    include: { location: { select: { name: true } } },
  });
  if (!session) throw new NotFoundError('Session de caisse introuvable.');
  if (session.status === 'CLOSED') {
    throw new ConflictError('Cette caisse est déjà fermée.');
  }

  // Le journal d'audit affichait l'ecart en unite mineure brute : "+150" pour
  // 1,50 EUR. On le formate avec la devise de l'entreprise, comme partout
  // ailleurs.
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: context.companyId },
    select: { currencyCode: true, locale: true },
  });
  const currency = await getCurrencyFormat(company.currencyCode);

  return prisma.$transaction(async (tx) => {
    const expected = await sessionExpectedAmount(tx, sessionId);
    const difference = input.countedAmount - expected;

    const closed = await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: context.userId,
        countedAmount: input.countedAmount,
        expectedAmount: expected,
        difference,
        closingNotes: input.notes ?? null,
      },
    });

    // L'ecart n'est pas corrige silencieusement : il est constate, journalise,
    // et reste lisible dans l'historique. Une caisse qui se rectifie toute
    // seule ne revele jamais un manquant.
    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'UPDATE',
      entityType: 'CashSession',
      entityId: sessionId,
      summary:
        difference === 0n
          ? `Caisse fermée à ${session.location.name}, sans écart`
          : `Caisse fermée à ${session.location.name} — écart de ${difference > 0n ? '+' : ''}${formatMoney(difference, currency, company.locale)}`,
      metadata: {
        expected: expected.toString(),
        counted: input.countedAmount.toString(),
        difference: difference.toString(),
      },
    });

    return closed;
  });
}

export async function recordCashMovement(
  context: CashContext,
  input: {
    locationId: string;
    kind: 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT';
    amount: bigint;
    reason: string;
  },
) {
  if (input.amount <= 0n) {
    throw new ValidationError('Le montant doit être supérieur à zéro.');
  }
  if (!input.reason.trim()) {
    throw new ValidationError('Indiquez le motif du mouvement.');
  }

  const location = await prisma.location.findFirst({
    where: { id: input.locationId, companyId: context.companyId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) throw new NotFoundError('Point de vente introuvable ou inactif.');

  // Un retrait est une sortie : le signe est decide ici et non par l'appelant,
  // pour qu'aucun ecran ne puisse envoyer un retrait positif par erreur.
  const signed = input.kind === 'WITHDRAWAL' ? -input.amount : input.amount;

  if (signed < 0n) {
    const balance = await cashBalance(context.companyId, input.locationId);
    if (balance + signed < 0n) {
      throw new ValidationError(
        `La caisse ne contient pas assez d'espèces pour ce retrait (solde : ${balance}).`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const movement = await applyCashMovement(tx, {
      companyId: context.companyId,
      locationId: input.locationId,
      kind: input.kind,
      amount: signed,
      reason: input.reason,
      userId: context.userId,
    });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'PAYMENT',
      entityType: 'CashMovement',
      entityId: movement.id,
      summary: `${CASH_MOVEMENT_LABELS[input.kind]} de caisse à ${location.name} : ${input.reason}`,
      metadata: { amount: signed.toString() },
    });

    return movement;
  });
}

export async function listCashMovements(
  companyId: string,
  query: { locationId?: string; sessionId?: string; page: number; pageSize: number },
) {
  const where: Prisma.CashMovementWhereInput = {
    companyId,
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.cashMovement.count({ where }),
    prisma.cashMovement.findMany({
      where,
      include: {
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

export async function listCashSessions(
  companyId: string,
  query: { locationId?: string; page: number; pageSize: number },
) {
  const where: Prisma.CashSessionWhereInput = {
    companyId,
    ...(query.locationId ? { locationId: query.locationId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.cashSession.count({ where }),
    prisma.cashSession.findMany({
      where,
      include: {
        location: { select: { name: true } },
        openedBy: { select: { fullName: true } },
        closedBy: { select: { fullName: true } },
        _count: { select: { movements: true } },
      },
      orderBy: { openedAt: 'desc' },
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

/** Etat de caisse d'un point de vente : session ouverte, solde, hors session. */
export async function cashOverview(companyId: string, locationId: string) {
  const [session, balance] = await Promise.all([
    prisma.cashSession.findFirst({
      where: { companyId, locationId, status: 'OPEN' },
      include: { openedBy: { select: { fullName: true } } },
      orderBy: { openedAt: 'desc' },
    }),
    cashBalance(companyId, locationId),
  ]);

  const sessionTotal = session
    ? ((
        await prisma.cashMovement.aggregate({
          where: { sessionId: session.id },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0n)
    : 0n;

  // Especes encaissees alors qu'aucune session n'etait ouverte : elles font
  // partie du solde mais n'apparaitront dans aucun rapprochement.
  const orphanAggregate = await prisma.cashMovement.aggregate({
    where: { companyId, locationId, sessionId: null },
    _sum: { amount: true },
  });

  return {
    session,
    balance,
    sessionTotal,
    outsideSession: orphanAggregate._sum.amount ?? 0n,
  };
}
