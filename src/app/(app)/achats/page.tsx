import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui/primitives';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { Icon } from '@/components/layout/icons';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import {
  PURCHASE_STATUS_LABELS,
  listPurchaseOrders,
  payablesBySupplier,
  type PurchaseStatus,
} from '@/server/services/purchases';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Achats' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(24).optional(),
  filter: z.enum(['unpaid']).optional().catch(undefined),
});

function tone(status: string) {
  if (status === 'RECEIVED') return 'success' as const;
  if (status === 'PARTIALLY_RECEIVED') return 'warning' as const;
  if (status === 'CANCELLED') return 'neutral' as const;
  if (status === 'ORDERED') return 'info' as const;
  return 'neutral' as const;
}

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('purchases.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    filter: typeof raw.filter === 'string' ? raw.filter : undefined,
  });

  const [result, payables, currency] = await Promise.all([
    listPurchaseOrders(context.companyId, {
      page: query.page,
      pageSize: 25,
      search: query.search,
      status: query.status || undefined,
      unpaidOnly: query.filter === 'unpaid',
    }),
    payablesBySupplier(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const totalPayable = payables.reduce((sum, row) => sum + row.outstanding, 0n);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Achats</h1>
          <p className="mt-1 text-ink-600">
            Vos commandes fournisseur, vos réceptions et ce que vous leur devez.
          </p>
        </div>
        {can(context, 'purchases.write') && (
          <ButtonLink href="/achats/nouvelle">Nouvel achat</ButtonLink>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total acheté" value={money(result.sums.total)} icon="truck" />
        <Tile label="Réglé" value={money(result.sums.paid)} icon="wallet" />
        <Tile
          label="Dettes fournisseur"
          value={money(totalPayable)}
          icon="minus"
          tone={totalPayable > 0n ? 'warning' : undefined}
        />
      </div>

      {payables.length > 0 && (
        <Card title="Dettes fournisseur" description="Ce que vous devez encore, fournisseur par fournisseur.">
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Fournisseur</th>
                  <th className="px-4 py-2 font-medium">Téléphone</th>
                  <th className="px-4 py-2 text-right font-medium">Commandes</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Montant dû</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {payables.map((row) => (
                  <tr key={row.supplierId ?? 'inconnu'}>
                    <td className="px-4 py-3 sm:px-5">
                      <p className="font-medium text-ink-900">{row.supplier?.name ?? 'Non précisé'}</p>
                      {row.supplier?.code && (
                        <p className="font-mono text-xs text-ink-400">{row.supplier.code}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.supplier?.phone ? (
                        <a
                          href={`tel:${row.supplier.phone.replace(/[^\d+]/g, '')}`}
                          className="text-brand-700 hover:underline"
                        >
                          {row.supplier.phone}
                        </a>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink-600">{row.orderCount}</td>
                    <td className="tabular px-4 py-3 text-right font-medium text-amber-700 sm:px-5">
                      {money(row.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ListToolbar
        placeholder="Numéro, référence ou fournisseur"
        filters={[
          {
            name: 'status',
            label: 'Tous les statuts',
            options: Object.entries(PURCHASE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          },
          {
            name: 'filter',
            label: 'Réglées et non réglées',
            options: [{ value: 'unpaid', label: 'Non réglées' }],
          },
        ]}
      />

      <Card title={`${result.total} commande(s)`}>
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucun achat"
            description="Enregistrez vos achats pour alimenter votre stock et suivre vos dettes fournisseur."
            action={
              can(context, 'purchases.write') ? (
                <ButtonLink href="/achats/nouvelle" variant="secondary">
                  Enregistrer un achat
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Numéro</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Fournisseur</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Reste dû</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {result.items.map((order) => (
                  <tr key={order.id}>
                    <td className="px-4 py-3 sm:px-5">
                      <Link
                        href={`/achats/${order.id}`}
                        className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                      >
                        {order.number}
                      </Link>
                      {order.reference && (
                        <p className="text-xs text-ink-400">{order.reference}</p>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                      {order.orderDate.toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{order.supplier?.name ?? '—'}</td>
                    <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                      {money(order.total)}
                    </td>
                    <td
                      className={`tabular px-4 py-3 text-right font-medium ${
                        order.balanceDue > 0n ? 'text-amber-700' : 'text-ink-400'
                      }`}
                    >
                      {money(order.balanceDue)}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <Badge tone={tone(order.status)}>
                        {PURCHASE_STATUS_LABELS[order.status as PurchaseStatus] ?? order.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  tone?: 'warning';
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-ink-200">
      <div className="flex items-center gap-2 text-ink-500">
        <Icon name={icon} className="size-4" />
        <p className="text-sm">{label}</p>
      </div>
      <p className={`tabular mt-2 text-2xl font-bold ${tone === 'warning' ? 'text-amber-600' : 'text-ink-900'}`}>
        {value}
      </p>
    </div>
  );
}
