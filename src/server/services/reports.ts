import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import type { Period, PeriodKey } from '@/lib/periods';

/**
 * Rapports et indicateurs.
 *
 * Tout est calcule a partir des documents reellement enregistres — factures,
 * paiements, depenses, mouvements de stock — et jamais depuis des compteurs
 * tenus a part. Un chiffre affiche ici doit pouvoir etre retrouve en ouvrant
 * les documents qui le composent.
 *
 * Les factures **annulees et en brouillon sont systematiquement exclues** : une
 * facture annulee n'est pas un chiffre d'affaires, un brouillon n'est pas encore
 * une vente.
 */

const LIVE_INVOICE_STATUSES = { notIn: ['CANCELLED', 'DRAFT'] };

export { PERIOD_LABELS, PERIOD_ORDER } from '@/lib/periods';
export type { Period, PeriodKey } from '@/lib/periods';

/**
 * Bornes d'une periode nommee.
 *
 * La semaine commence le lundi : c'est la convention en vigueur dans la
 * quasi-totalite des pays vises, et un rapport hebdomadaire qui commencerait le
 * dimanche decalerait tous les totaux d'une journee.
 */
export function resolvePeriod(key: PeriodKey, now = new Date(), custom?: Partial<Period>): Period {
  if (key === 'custom' && custom?.from && custom?.to) {
    return { from: startOfDay(custom.from), to: endOfDay(custom.to) };
  }

  const year = now.getFullYear();
  const month = now.getMonth();

  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'week': {
      const weekday = (now.getDay() + 6) % 7; // 0 = lundi
      const monday = new Date(year, month, now.getDate() - weekday);
      return { from: startOfDay(monday), to: endOfDay(now) };
    }
    case 'month':
      return { from: new Date(year, month, 1), to: endOfDay(now) };
    case 'quarter': {
      const quarterStart = Math.floor(month / 3) * 3;
      return { from: new Date(year, quarterStart, 1), to: endOfDay(now) };
    }
    case 'year':
      return { from: new Date(year, 0, 1), to: endOfDay(now) };
    default:
      return { from: new Date(year, month, 1), to: endOfDay(now) };
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Periode precedente de meme duree, pour les comparaisons. */
export function previousPeriod(period: Period): Period {
  const span = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - span - 1),
    to: new Date(period.from.getTime() - 1),
  };
}

export interface SalesSummary {
  /** Montant facture sur la periode, taxes comprises. */
  revenue: bigint;
  /** Cout d'achat des articles vendus, fige a l'emission. */
  cost: bigint;
  /** revenue - cost. Marge brute, hors depenses de fonctionnement. */
  grossProfit: bigint;
  invoiceCount: number;
  /** Panier moyen. */
  averageTicket: bigint;
}

export async function salesSummary(
  companyId: string,
  period: Period,
  locationId?: string,
): Promise<SalesSummary> {
  const where: Prisma.InvoiceWhereInput = {
    companyId,
    status: LIVE_INVOICE_STATUSES,
    issueDate: { gte: period.from, lte: period.to },
    ...(locationId ? { locationId } : {}),
  };

  const aggregate = await prisma.invoice.aggregate({
    where,
    _sum: { total: true, costTotal: true },
    _count: { _all: true },
  });

  const revenue = aggregate._sum.total ?? 0n;
  const cost = aggregate._sum.costTotal ?? 0n;
  const count = aggregate._count._all;

  return {
    revenue,
    cost,
    grossProfit: revenue - cost,
    invoiceCount: count,
    averageTicket: count > 0 ? revenue / BigInt(count) : 0n,
  };
}

/** Encaissements reellement recus sur la periode (et non factures). */
export async function collectedSummary(companyId: string, period: Period, locationId?: string) {
  const aggregate = await prisma.payment.aggregate({
    where: {
      companyId,
      direction: 'IN',
      paidAt: { gte: period.from, lte: period.to },
      ...(locationId ? { locationId } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return { collected: aggregate._sum.amount ?? 0n, count: aggregate._count._all };
}

export async function expenseSummary(companyId: string, period: Period, locationId?: string) {
  const aggregate = await prisma.expense.aggregate({
    where: {
      companyId,
      spentAt: { gte: period.from, lte: period.to },
      ...(locationId ? { locationId } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return { total: aggregate._sum.amount ?? 0n, count: aggregate._count._all };
}

export async function purchaseSummary(companyId: string, period: Period) {
  const aggregate = await prisma.purchaseOrder.aggregate({
    where: {
      companyId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      orderDate: { gte: period.from, lte: period.to },
    },
    _sum: { total: true },
    _count: { _all: true },
  });

  return { total: aggregate._sum.total ?? 0n, count: aggregate._count._all };
}

/** Creances clients et dettes fournisseur, a l'instant present. */
export async function outstandingSummary(companyId: string) {
  const [receivable, payable, overdue] = await Promise.all([
    prisma.invoice.aggregate({
      where: { companyId, status: LIVE_INVOICE_STATUSES, balanceDue: { gt: 0n } },
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { companyId, status: { notIn: ['CANCELLED', 'DRAFT'] }, balanceDue: { gt: 0n } },
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: LIVE_INVOICE_STATUSES,
        balanceDue: { gt: 0n },
        dueDate: { lt: new Date() },
      },
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
  ]);

  return {
    receivable: receivable._sum.balanceDue ?? 0n,
    receivableCount: receivable._count._all,
    payable: payable._sum.balanceDue ?? 0n,
    payableCount: payable._count._all,
    overdue: overdue._sum.balanceDue ?? 0n,
    overdueCount: overdue._count._all,
  };
}

export interface SeriesPoint {
  /** Cle ISO du jour ou du mois : "2026-08-19" ou "2026-08". */
  key: string;
  label: string;
  revenue: bigint;
  expenses: bigint;
}

/**
 * Serie chronologique du chiffre d'affaires et des depenses.
 *
 * L'agregation se fait en SQL (`date_trunc`) plutot qu'en memoire : sur une
 * annee de ventes, remonter chaque facture pour les grouper cote Node ferait
 * transiter des milliers de lignes pour n'en afficher que douze.
 */
export async function revenueSeries(
  companyId: string,
  period: Period,
  granularity: 'day' | 'month',
): Promise<SeriesPoint[]> {
  const unit = granularity === 'day' ? 'day' : 'month';

  const [revenueRows, expenseRows] = await Promise.all([
    prisma.$queryRaw<Array<{ bucket: Date; total: bigint }>>`
      SELECT date_trunc(${unit}, "issueDate") AS bucket, COALESCE(SUM("total"), 0)::bigint AS total
      FROM "invoices"
      WHERE "companyId" = ${companyId}
        AND "status" NOT IN ('CANCELLED', 'DRAFT')
        AND "issueDate" >= ${period.from} AND "issueDate" <= ${period.to}
      GROUP BY bucket
      ORDER BY bucket
    `,
    prisma.$queryRaw<Array<{ bucket: Date; total: bigint }>>`
      SELECT date_trunc(${unit}, "spentAt") AS bucket, COALESCE(SUM("amount"), 0)::bigint AS total
      FROM "expenses"
      WHERE "companyId" = ${companyId}
        AND "spentAt" >= ${period.from} AND "spentAt" <= ${period.to}
      GROUP BY bucket
      ORDER BY bucket
    `,
  ]);

  const revenueByKey = new Map(revenueRows.map((row) => [bucketKey(row.bucket, granularity), row.total]));
  const expenseByKey = new Map(expenseRows.map((row) => [bucketKey(row.bucket, granularity), row.total]));

  // On enumere tous les intervalles de la periode, y compris ceux sans activite :
  // un graphique qui saute les jours creux donne une fausse impression de
  // regularite.
  const points: SeriesPoint[] = [];
  const cursor = new Date(period.from);

  while (cursor <= period.to) {
    const key = bucketKey(cursor, granularity);
    points.push({
      key,
      label: formatBucket(cursor, granularity),
      revenue: revenueByKey.get(key) ?? 0n,
      expenses: expenseByKey.get(key) ?? 0n,
    });

    if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1);

    // Garde-fou : une periode aberrante ne doit pas boucler indefiniment.
    if (points.length > 400) break;
  }

  return points;
}

function bucketKey(date: Date, granularity: 'day' | 'month'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  if (granularity === 'month') return `${year}-${month}`;
  return `${year}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatBucket(date: Date, granularity: 'day' | 'month'): string {
  if (granularity === 'month') {
    return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  }
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export interface TopProduct {
  productId: string | null;
  name: string;
  sku: string;
  quantity: bigint;
  revenue: bigint;
  profit: bigint;
}

export async function topProducts(
  companyId: string,
  period: Period,
  limit = 10,
): Promise<TopProduct[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      productId: string | null;
      description: string;
      quantity: bigint;
      revenue: bigint;
      cost: bigint;
    }>
  >`
    SELECT
      l."productId",
      MIN(l."description") AS description,
      COALESCE(SUM(l."quantity"), 0)::bigint AS quantity,
      COALESCE(SUM(l."lineTotal"), 0)::bigint AS revenue,
      COALESCE(SUM(l."unitCost" * l."quantity" / 1000), 0)::bigint AS cost
    FROM "invoice_lines" l
    JOIN "invoices" i ON i."id" = l."invoiceId"
    WHERE i."companyId" = ${companyId}
      AND i."status" NOT IN ('CANCELLED', 'DRAFT')
      AND i."issueDate" >= ${period.from} AND i."issueDate" <= ${period.to}
    GROUP BY l."productId"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  const productIds = rows.map((row) => row.productId).filter(Boolean) as string[];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, name: true, sku: true },
      })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));

  return rows.map((row) => {
    const product = row.productId ? byId.get(row.productId) : null;
    return {
      productId: row.productId,
      name: product?.name ?? row.description,
      sku: product?.sku ?? '',
      quantity: row.quantity,
      revenue: row.revenue,
      profit: row.revenue - row.cost,
    };
  });
}

export interface TopCustomer {
  customerId: string | null;
  name: string;
  code: string;
  invoiceCount: number;
  revenue: bigint;
  outstanding: bigint;
}

export async function topCustomers(
  companyId: string,
  period: Period,
  limit = 10,
): Promise<TopCustomer[]> {
  const rows = await prisma.invoice.groupBy({
    by: ['customerId'],
    where: {
      companyId,
      status: LIVE_INVOICE_STATUSES,
      issueDate: { gte: period.from, lte: period.to },
    },
    _sum: { total: true, balanceDue: true },
    _count: { _all: true },
  });

  const sorted = rows
    .sort((a, b) => {
      const left = a._sum.total ?? 0n;
      const right = b._sum.total ?? 0n;
      return right > left ? 1 : right < left ? -1 : 0;
    })
    .slice(0, limit);

  const customerIds = sorted.map((row) => row.customerId).filter(Boolean) as string[];
  const customers = customerIds.length
    ? await prisma.partner.findMany({
        where: { id: { in: customerIds }, companyId },
        select: { id: true, name: true, code: true },
      })
    : [];
  const byId = new Map(customers.map((customer) => [customer.id, customer]));

  return sorted.map((row) => {
    const customer = row.customerId ? byId.get(row.customerId) : null;
    return {
      customerId: row.customerId,
      name: customer?.name ?? 'Client de passage',
      code: customer?.code ?? '',
      invoiceCount: row._count._all,
      revenue: row._sum.total ?? 0n,
      outstanding: row._sum.balanceDue ?? 0n,
    };
  });
}

/** Repartition du chiffre d'affaires par mode de reglement. */
export async function revenueByPaymentMethod(companyId: string, period: Period) {
  const rows = await prisma.payment.groupBy({
    by: ['methodId'],
    where: { companyId, direction: 'IN', paidAt: { gte: period.from, lte: period.to } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const methodIds = rows.map((row) => row.methodId).filter(Boolean) as string[];
  const methods = methodIds.length
    ? await prisma.paymentMethod.findMany({
        where: { id: { in: methodIds }, companyId },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(methods.map((method) => [method.id, method]));

  return rows
    .map((row) => ({
      methodId: row.methodId,
      name: row.methodId ? (byId.get(row.methodId)?.name ?? 'Mode supprime') : 'Non precise',
      count: row._count._all,
      total: row._sum.amount ?? 0n,
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export interface DashboardData {
  period: Period;
  sales: SalesSummary;
  previousSales: SalesSummary;
  collected: { collected: bigint; count: number };
  expenses: { total: bigint; count: number };
  purchases: { total: bigint; count: number };
  outstanding: Awaited<ReturnType<typeof outstandingSummary>>;
  /** Marge brute moins depenses de fonctionnement de la periode. */
  netResult: bigint;
  series: SeriesPoint[];
  topProducts: TopProduct[];
}

export async function dashboardData(
  companyId: string,
  period: Period,
  granularity: 'day' | 'month',
  locationId?: string,
): Promise<DashboardData> {
  const previous = previousPeriod(period);

  const [sales, previousSales, collected, expenses, purchases, outstanding, series, products] =
    await Promise.all([
      salesSummary(companyId, period, locationId),
      salesSummary(companyId, previous, locationId),
      collectedSummary(companyId, period, locationId),
      expenseSummary(companyId, period, locationId),
      purchaseSummary(companyId, period),
      outstandingSummary(companyId),
      revenueSeries(companyId, period, granularity),
      topProducts(companyId, period, 5),
    ]);

  return {
    period,
    sales,
    previousSales,
    collected,
    expenses,
    purchases,
    outstanding,
    // "Estime" parce que la marge repose sur le prix d'achat fige a l'emission
    // et que les depenses retenues sont celles de la periode, pas leur part
    // reellement imputable aux ventes de la periode.
    netResult: sales.grossProfit - expenses.total,
    series,
    topProducts: products,
  };
}

/** Variation en centiemes de point entre deux valeurs. `null` si base nulle. */
export function variation(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const delta = ((current - previous) * 10_000n) / previous;
  return Number(delta) / 100;
}
