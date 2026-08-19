import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { recordAuditTx } from '@/server/audit';
import { nextDocumentNumber } from '@/server/sequences';
import { applyCashMovement, cashBalance } from '@/server/services/cash';

/**
 * Depenses de fonctionnement.
 *
 * Une depense reglee en especes sort de la caisse du point de vente : sans ce
 * lien, le solde de caisse ne correspondrait jamais au tiroir.
 */

/** Categories installees a la creation d'une entreprise. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Transport',
  'Loyer',
  'Salaires',
  'Electricite',
  'Eau',
  'Internet et telephone',
  'Marketing',
  'Fournitures',
  'Maintenance',
  'Taxes et impots',
  'Autres',
] as const;

export async function provisionExpenseCategories(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name, index) => ({
      companyId,
      name,
      isSystem: true,
      position: index + 1,
    })),
    skipDuplicates: true,
  });
}

export async function listExpenseCategories(companyId: string, includeInactive = false) {
  return prisma.expenseCategory.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    include: { _count: { select: { expenses: true } } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export async function createExpenseCategory(companyId: string, name: string) {
  const duplicate = await prisma.expenseCategory.findFirst({
    where: { companyId, name },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Une categorie de depense porte deja ce nom.');

  const last = await prisma.expenseCategory.findFirst({
    where: { companyId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return prisma.expenseCategory.create({
    data: { companyId, name, isSystem: false, position: (last?.position ?? 0) + 1 },
  });
}

export async function deleteExpenseCategory(companyId: string, categoryId: string) {
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, companyId },
    include: { _count: { select: { expenses: true } } },
  });
  if (!category) throw new NotFoundError('Categorie de depense introuvable.');

  if (category._count.expenses > 0) {
    // Les depenses passees conservent leur categorie : on la desactive plutot
    // que de rendre l'historique illisible.
    return prisma.expenseCategory.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
  }

  await prisma.expenseCategory.delete({ where: { id: categoryId } });
  return null;
}

export interface ExpenseContext {
  companyId: string;
  userId: string;
  paymentPrefix: string;
}

export interface ExpenseInput {
  categoryId?: string;
  locationId?: string;
  supplierId?: string;
  methodId?: string;
  amount: bigint;
  spentAt?: Date;
  description: string;
  reference?: string;
  notes?: string;
}

export async function recordExpense(context: ExpenseContext, input: ExpenseInput) {
  if (input.amount <= 0n) {
    throw new ValidationError('Le montant de la depense doit etre superieur a zero.');
  }
  if (!input.description.trim()) {
    throw new ValidationError('Decrivez la depense.');
  }

  if (input.categoryId) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: input.categoryId, companyId: context.companyId },
      select: { id: true },
    });
    if (!category) throw new NotFoundError('Categorie de depense introuvable.');
  }

  if (input.supplierId) {
    const supplier = await prisma.partner.findFirst({
      where: { id: input.supplierId, companyId: context.companyId, kind: 'SUPPLIER' },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundError('Fournisseur introuvable.');
  }

  let method: { id: string; name: string; affectsCash: boolean; isCredit: boolean } | null = null;
  if (input.methodId) {
    const found = await prisma.paymentMethod.findFirst({
      where: { id: input.methodId, companyId: context.companyId, isActive: true },
      select: { id: true, name: true, affectsCash: true, isCredit: true },
    });
    if (!found) throw new NotFoundError('Mode de reglement introuvable ou desactive.');
    if (found.isCredit) {
      throw new ValidationError(
        "\"Credit\" n'est pas un mode de paiement d'une depense. Enregistrez plutot une commande fournisseur, qui suivra la dette.",
      );
    }
    method = found;
  }

  if (input.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: input.locationId, companyId: context.companyId },
      select: { id: true },
    });
    if (!location) throw new NotFoundError('Point de vente introuvable.');
  }

  // Une depense en especes ne peut pas vider une caisse qui n'a pas l'argent :
  // c'est le signe d'une saisie erronee, ou d'un encaissement oublie.
  if (method?.affectsCash && input.locationId) {
    const balance = await cashBalance(context.companyId, input.locationId);
    if (balance < input.amount) {
      throw new ValidationError(
        `La caisse ne contient pas assez d'especes pour cette depense (solde : ${balance}).`,
      );
    }
  }

  const spentAt = input.spentAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, context.companyId, 'PAYMENT', {
      prefix: `${context.paymentPrefix}-DEP`,
      now: spentAt,
    });

    const expense = await tx.expense.create({
      data: {
        companyId: context.companyId,
        number,
        categoryId: input.categoryId ?? null,
        locationId: input.locationId ?? null,
        supplierId: input.supplierId ?? null,
        methodId: input.methodId ?? null,
        amount: input.amount,
        spentAt,
        description: input.description,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        userId: context.userId,
      },
    });

    if (method?.affectsCash && input.locationId) {
      await applyCashMovement(tx, {
        companyId: context.companyId,
        locationId: input.locationId,
        kind: 'EXPENSE',
        amount: -input.amount,
        reason: input.description,
        reference: input.reference ?? null,
        expenseId: expense.id,
        userId: context.userId,
      });
    }

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'CREATE',
      entityType: 'Expense',
      entityId: expense.id,
      summary: `Depense ${number} : ${input.description}`,
      metadata: { amount: input.amount.toString() },
    });

    return expense;
  });
}

export async function deleteExpense(context: ExpenseContext, expenseId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError("Indiquez le motif de la suppression.");

  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, companyId: context.companyId },
  });
  if (!expense) throw new NotFoundError('Depense introuvable.');

  return prisma.$transaction(async (tx) => {
    // Le mouvement de caisse est neutralise par un mouvement inverse : le
    // journal de caisse reste en ajout seul.
    const movements = await tx.cashMovement.findMany({
      where: { expenseId, companyId: context.companyId },
      select: { locationId: true, amount: true },
    });

    for (const movement of movements) {
      await applyCashMovement(tx, {
        companyId: context.companyId,
        locationId: movement.locationId,
        kind: 'ADJUSTMENT',
        amount: -movement.amount,
        reason: `Annulation de la depense ${expense.number}`,
        userId: context.userId,
      });
    }

    await tx.expense.delete({ where: { id: expenseId } });

    await recordAuditTx(tx, {
      companyId: context.companyId,
      userId: context.userId,
      action: 'DELETE',
      entityType: 'Expense',
      entityId: expenseId,
      summary: `Depense ${expense.number} supprimee : ${reason}`,
      metadata: { amount: expense.amount.toString(), description: expense.description },
    });
  });
}

export interface ExpenseListQuery {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  locationId?: string;
  from?: Date;
  to?: Date;
}

export async function listExpenses(companyId: string, query: ExpenseListQuery) {
  const search = query.search?.trim();
  const where: Prisma.ExpenseWhereInput = {
    companyId,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.from || query.to
      ? {
          spentAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items, aggregate] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        location: { select: { name: true } },
        supplier: { select: { name: true } },
        method: { select: { name: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { spentAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
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

/** Repartition des depenses par categorie sur une periode. */
export async function expensesByCategory(companyId: string, from?: Date, to?: Date) {
  const rows = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: {
      companyId,
      ...(from || to
        ? { spentAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const categoryIds = rows.map((row) => row.categoryId).filter(Boolean) as string[];
  const categories = categoryIds.length
    ? await prisma.expenseCategory.findMany({
        where: { id: { in: categoryIds }, companyId },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(categories.map((category) => [category.id, category]));

  return rows
    .map((row) => ({
      categoryId: row.categoryId,
      name: row.categoryId ? (byId.get(row.categoryId)?.name ?? 'Categorie supprimee') : 'Sans categorie',
      count: row._count._all,
      total: row._sum.amount ?? 0n,
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}
