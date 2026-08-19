import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Card, EmptyState } from '@/components/ui/primitives';
import { PeriodFilter } from '@/components/layout/period-filter';
import { RankingBars } from '@/components/charts/ranking-bars';
import { RevenueChart } from '@/components/charts/revenue-chart';
import { StatTile } from '@/components/charts/stat-tile';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import {
  PERIOD_LABELS,
  collectedSummary,
  expenseSummary,
  outstandingSummary,
  purchaseSummary,
  resolvePeriod,
  revenueByPaymentMethod,
  revenueSeries,
  salesSummary,
  topCustomers,
  topProducts,
  variation,
  previousPeriod,
  type PeriodKey,
} from '@/server/services/reports';
import { expensesByCategory } from '@/server/services/expenses';
import { stockSummary } from '@/server/services/stock-query';
import { EXPORTS } from '@/server/services/exports';
import { hasPermission, type PermissionKey } from '@/server/permissions';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Rapports' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'quarter', 'year']).default('month').catch('month'),
});

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('reports.view');
  const raw = await searchParams;
  const query = querySchema.parse({
    period: typeof raw.period === 'string' ? raw.period : undefined,
  });

  const period = resolvePeriod(query.period as PeriodKey);
  const granularity: 'day' | 'month' =
    query.period === 'year' || query.period === 'quarter' ? 'month' : 'day';

  const [
    sales,
    previousSales,
    collected,
    expenses,
    purchases,
    outstanding,
    series,
    products,
    customers,
    methods,
    categories,
    stock,
    currency,
  ] = await Promise.all([
    salesSummary(context.companyId, period),
    salesSummary(context.companyId, previousPeriod(period)),
    collectedSummary(context.companyId, period),
    expenseSummary(context.companyId, period),
    purchaseSummary(context.companyId, period),
    outstandingSummary(context.companyId),
    revenueSeries(context.companyId, period, granularity),
    topProducts(context.companyId, period, 8),
    topCustomers(context.companyId, period, 8),
    revenueByPaymentMethod(context.companyId, period),
    expensesByCategory(context.companyId, period.from, period.to),
    stockSummary(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const scale = 10n ** BigInt(currency.decimals);
  const toNumber = (amount: bigint) => Number(amount / scale);

  const canExport = can(context, 'reports.export');
  const availableExports = Object.entries(EXPORTS).filter(([, definition]) =>
    hasPermission(context.permissions, definition.permission as PermissionKey),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Rapports</h1>
          <p className="mt-1 text-ink-600">
            Vos chiffres sur {PERIOD_LABELS[query.period as PeriodKey].toLowerCase()}, calcules a
            partir de vos documents reels.
          </p>
        </div>
        <PeriodFilter />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Chiffre d'affaires"
          value={money(sales.revenue)}
          icon="chart"
          delta={variation(sales.revenue, previousSales.revenue)}
          deltaLabel="vs periode precedente"
          /* Facture n'est pas encaisse : avec la vente a credit, l'ecart entre
             les deux est precisement ce qui manque en caisse. */
          hint={`${money(collected.collected)} encaisses sur la periode`}
        />
        <StatTile
          label="Marge brute"
          value={money(sales.grossProfit)}
          icon="cash"
          hint="Ventes moins prix d'achat"
        />
        <StatTile
          label="Depenses"
          value={money(expenses.total)}
          icon="minus"
          higherIsBetter={false}
        />
        <StatTile
          label="Resultat estime"
          value={money(sales.grossProfit - expenses.total)}
          icon="wallet"
          tone={sales.grossProfit - expenses.total < 0n ? 'danger' : 'success'}
        />
      </div>

      <Card title="Chiffre d'affaires et depenses">
        <RevenueChart
          currency={currency}
          locale={context.locale}
          points={series.map((point) => ({
            label: point.label,
            revenue: point.revenue.toString(),
            expenses: point.expenses.toString(),
          }))}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Produits les plus vendus">
          <RankingBars
            emptyMessage="Aucune vente sur cette periode."
            rows={products.map((product) => ({
              id: product.productId ?? product.name,
              label: product.name,
              sublabel: `${formatQuantity(product.quantity, context.locale)} · marge ${money(product.profit)}`,
              value: toNumber(product.revenue),
              valueLabel: money(product.revenue),
            }))}
          />
        </Card>

        <Card title="Principaux clients">
          <RankingBars
            emptyMessage="Aucun client sur cette periode."
            rows={customers.map((customer) => ({
              id: customer.customerId ?? customer.name,
              label: customer.name,
              sublabel:
                customer.outstanding > 0n
                  ? `${customer.invoiceCount} facture(s) · ${money(customer.outstanding)} du`
                  : `${customer.invoiceCount} facture(s)`,
              value: toNumber(customer.revenue),
              valueLabel: money(customer.revenue),
            }))}
          />
        </Card>

        <Card title="Encaissements par mode de reglement">
          <RankingBars
            emptyMessage="Aucun encaissement sur cette periode."
            rows={methods.map((method) => ({
              id: method.methodId ?? method.name,
              label: method.name,
              sublabel: `${method.count} paiement(s)`,
              value: toNumber(method.total),
              valueLabel: money(method.total),
            }))}
          />
        </Card>

        <Card title="Depenses par categorie">
          <RankingBars
            emptyMessage="Aucune depense sur cette periode."
            rows={categories.map((category) => ({
              id: category.categoryId ?? category.name,
              label: category.name,
              sublabel: `${category.count} depense(s)`,
              value: toNumber(category.total),
              valueLabel: money(category.total),
            }))}
          />
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Creances clients"
          value={money(outstanding.receivable)}
          icon="users"
          tone={outstanding.receivable > 0n ? 'warning' : undefined}
        />
        <StatTile
          label="Dettes fournisseur"
          value={money(outstanding.payable)}
          icon="truck"
          tone={outstanding.payable > 0n ? 'warning' : undefined}
        />
        <StatTile label="Achats de la periode" value={money(purchases.total)} icon="box" />
        <StatTile
          label="Valeur du stock"
          value={money(stock.totalValue)}
          icon="layers"
          hint="Au prix d'achat"
        />
      </div>

      <Card
        title="Exports"
        description="Telechargez vos donnees au format CSV, exploitable dans Excel ou LibreOffice."
      >
        {!canExport ? (
          <EmptyState
            title="Export non autorise"
            description="Votre role ne permet pas de telecharger les donnees. Contactez votre administrateur."
          />
        ) : availableExports.length === 0 ? (
          <EmptyState title="Aucun export disponible" description="Votre role ne donne acces a aucun module exportable." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {availableExports.map(([key, definition]) => (
              <li key={key}>
                {/*
                  Un lien simple plutot qu'un bouton : le navigateur gere le
                  telechargement nativement, y compris sur un telephone, sans
                  code cote client.
                */}
                <a
                  href={`/api/exports/${key}?period=${query.period}`}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-ink-200 px-3 text-sm font-medium text-ink-800 transition hover:border-brand-500 hover:bg-brand-50"
                >
                  {definition.label}
                  <span className="text-xs text-ink-400">
                    {definition.needsPeriod ? 'periode' : 'complet'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-ink-500">
        Les factures annulees et les brouillons sont exclus de tous les chiffres. Le resultat est
        dit <em>estime</em> : la marge repose sur les prix d&apos;achat figes a l&apos;emission, et
        les depenses retenues sont celles de la periode.{' '}
        <Link href="/factures" className="font-medium text-brand-700 hover:underline">
          Verifier les factures
        </Link>
      </p>
    </div>
  );
}
