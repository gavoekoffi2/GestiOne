import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { PeriodFilter } from '@/components/layout/period-filter';
import { AlertsPanel } from '@/components/layout/alerts-panel';
import { RevenueChart } from '@/components/charts/revenue-chart';
import { RankingBars } from '@/components/charts/ranking-bars';
import { StatTile } from '@/components/charts/stat-tile';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import {
  PERIOD_LABELS,
  dashboardData,
  resolvePeriod,
  variation,
  type PeriodKey,
} from '@/server/services/reports';
import { cashBalance } from '@/server/services/cash';
import { stockSummary } from '@/server/services/stock-query';
import { listInvoices } from '@/server/services/invoices';
import { listLocations } from '@/server/services/locations';
import { getCompanyProfile } from '@/server/services/companies';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'quarter', 'year']).default('month').catch('month'),
  locationId: z.string().trim().max(64).optional(),
});

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('dashboard.view');
  const raw = await searchParams;
  const query = querySchema.parse({
    period: typeof raw.period === 'string' ? raw.period : undefined,
    locationId: typeof raw.locationId === 'string' ? raw.locationId : undefined,
  });

  const period = resolvePeriod(query.period as PeriodKey);
  // Une journee ou une semaine se lit jour par jour ; au-dela du trimestre,
  // douze points mensuels sont plus lisibles que quatre-vingt-dix quotidiens.
  const granularity: 'day' | 'month' =
    query.period === 'year' || query.period === 'quarter' ? 'month' : 'day';

  const [data, currency, company, locations] = await Promise.all([
    dashboardData(context.companyId, period, granularity, query.locationId || undefined),
    getCurrencyFormat(context.currencyCode),
    getCompanyProfile(context.companyId),
    listLocations(context.companyId),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);
  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);

  // Les indicateurs conditionnes par une permission ne sont charges que si
  // l'utilisateur y a droit : un caissier ne doit pas deduire la marge.
  const [stock, cash, recentInvoices] = await Promise.all([
    can(context, 'stock.read')
      ? stockSummary(context.companyId, query.locationId || undefined)
      : Promise.resolve(null),
    can(context, 'cash.read') && (query.locationId || context.defaultLocationId)
      ? cashBalance(context.companyId, (query.locationId || context.defaultLocationId) as string)
      : Promise.resolve(null),
    can(context, 'invoices.read')
      ? listInvoices(context.companyId, { page: 1, pageSize: 6 })
      : Promise.resolve(null),
  ]);

  const canSeeProfit = can(context, 'products.cost.read') || can(context, 'reports.view');
  const scale = 10n ** BigInt(currency.decimals);
  const toNumber = (amount: bigint) => Number(amount / scale);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">
            Bonjour {context.userFullName.split(' ')[0]}
          </h1>
          <p className="mt-1 text-ink-600">
            {company.name} · {PERIOD_LABELS[query.period as PeriodKey].toLowerCase()}
          </p>
        </div>
        <PeriodFilter
          locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        />
      </div>

      {/* Les alertes passent avant les chiffres : ce sont elles qui appellent
          une action aujourd'hui. */}
      <AlertsPanel companyId={context.companyId} permissions={context.permissions} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Chiffre d'affaires"
          value={money(data.sales.revenue)}
          icon="chart"
          delta={variation(data.sales.revenue, data.previousSales.revenue)}
          deltaLabel="vs periode precedente"
        />
        <StatTile
          label="Encaisse"
          value={money(data.collected.collected)}
          icon="wallet"
          hint={`${data.collected.count} paiement(s)`}
        />
        <StatTile
          label="Depenses"
          value={money(data.expenses.total)}
          icon="minus"
          higherIsBetter={false}
          hint={`${data.expenses.count} depense(s)`}
        />
        {canSeeProfit && (
          <StatTile
            label="Resultat estime"
            value={money(data.netResult)}
            icon="cash"
            tone={data.netResult < 0n ? 'danger' : 'success'}
            hint="Marge brute moins depenses"
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Creances clients"
          value={money(data.outstanding.receivable)}
          icon="users"
          tone={data.outstanding.receivable > 0n ? 'warning' : undefined}
          hint={`${data.outstanding.receivableCount} facture(s) impayee(s)`}
        />
        <StatTile
          label="En retard"
          value={money(data.outstanding.overdue)}
          icon="list"
          tone={data.outstanding.overdue > 0n ? 'danger' : undefined}
          hint={`${data.outstanding.overdueCount} facture(s) echue(s)`}
        />
        <StatTile
          label="Dettes fournisseur"
          value={money(data.outstanding.payable)}
          icon="truck"
          tone={data.outstanding.payable > 0n ? 'warning' : undefined}
          hint={`${data.outstanding.payableCount} commande(s)`}
        />
        {cash !== null ? (
          <StatTile label="Solde de caisse" value={money(cash)} icon="cash" />
        ) : (
          stock && (
            <StatTile
              label="Valeur du stock"
              value={money(stock.totalValue)}
              icon="box"
              hint="Au prix d'achat"
            />
          )
        )}
      </div>

      <Card
        title="Evolution"
        description="Chiffre d'affaires facture et depenses engagees sur la periode."
      >
        <RevenueChart
          currency={currency}
          locale={context.locale}
          points={data.series.map((point) => ({
            label: point.label,
            revenue: point.revenue.toString(),
            expenses: point.expenses.toString(),
          }))}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Produits les plus vendus"
          description="Classes par chiffre d'affaires sur la periode."
        >
          <RankingBars
            emptyMessage="Aucune vente sur cette periode."
            rows={data.topProducts.map((product) => ({
              id: product.productId ?? product.name,
              label: product.name,
              sublabel: `${formatQuantity(product.quantity, context.locale)} vendu(s)`,
              value: toNumber(product.revenue),
              valueLabel: money(product.revenue),
            }))}
          />
        </Card>

        {recentInvoices && (
          <Card
            title="Dernieres factures"
            action={
              <Link href="/factures" className="text-sm font-semibold text-brand-700 hover:underline">
                Tout voir
              </Link>
            }
          >
            {recentInvoices.items.length === 0 ? (
              <EmptyState
                title="Aucune facture"
                description="Les ventes et factures emises apparaitront ici."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {recentInvoices.items.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/factures/${invoice.id}`}
                        className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                      >
                        {invoice.number}
                      </Link>
                      <p className="truncate text-sm text-ink-600">
                        {invoice.customer?.name ?? 'Client de passage'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-medium text-ink-900">
                        {money(invoice.total)}
                      </p>
                      {invoice.balanceDue > 0n ? (
                        <Badge tone="warning">{money(invoice.balanceDue)} du</Badge>
                      ) : (
                        <Badge tone="success">Payee</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {data.sales.invoiceCount > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Summary label="Factures emises" value={String(data.sales.invoiceCount)} />
          <Summary label="Panier moyen" value={money(data.sales.averageTicket)} />
          <Summary label="Achats de la periode" value={money(data.purchases.total)} />
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 ring-1 ring-ink-200">
      <p className="text-xs uppercase tracking-wide text-ink-400">{label}</p>
      <p className="tabular mt-0.5 font-semibold text-ink-900">{value}</p>
    </div>
  );
}
