import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui/primitives';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { Icon } from '@/components/layout/icons';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { INVOICE_STATUS_LABELS, isOverdue, listInvoices, type InvoiceStatus } from '@/server/services/invoices';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Factures' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(24).optional(),
  filter: z.enum(['unpaid', 'overdue']).optional().catch(undefined),
});

function statusTone(status: string, overdue: boolean) {
  if (overdue) return 'danger' as const;
  if (status === 'PAID') return 'success' as const;
  if (status === 'PARTIALLY_PAID') return 'warning' as const;
  if (status === 'CANCELLED') return 'neutral' as const;
  return 'info' as const;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('invoices.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    filter: typeof raw.filter === 'string' ? raw.filter : undefined,
  });

  const [result, currency] = await Promise.all([
    listInvoices(context.companyId, {
      page: query.page,
      pageSize: PAGE_SIZE,
      search: query.search,
      status: query.status || undefined,
      unpaidOnly: query.filter === 'unpaid',
      overdueOnly: query.filter === 'overdue',
    }),
    getCurrencyFormat(context.currencyCode),
  ]);

  const canCollect = can(context, 'payments.create');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Factures</h1>
          <p className="mt-1 text-ink-600">
            Toutes vos factures, y compris celles issues des ventes au comptoir.
          </p>
        </div>
        {/* Deux points d'entree distincts : la vente au comptoir (encaissement
            immediat) et la facture composee ligne par ligne. Cette derniere
            n'etait accessible depuis aucun ecran. */}
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/ventes" variant="secondary">
            Vente au comptoir
          </ButtonLink>
          {can(context, 'invoices.write') && (
            <ButtonLink href="/factures/nouvelle">Nouvelle facture</ButtonLink>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total facture" value={formatMoney(result.sums.total, currency, context.locale)} icon="receipt" />
        <Tile label="Encaisse" value={formatMoney(result.sums.paid, currency, context.locale)} icon="wallet" />
        <Tile
          label="Reste dû"
          value={formatMoney(result.sums.balance, currency, context.locale)}
          icon="minus"
          tone={result.sums.balance > 0n ? 'warning' : undefined}
        />
      </div>

      {/* Recherche et filtres s'appliquent seuls, comme sur les autres listes. */}
      <ListToolbar
        placeholder="Numéro de facture ou client"
        filters={[
          {
            name: 'status',
            label: 'Tous les statuts',
            options: Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          },
          {
            name: 'filter',
            label: 'Payées et impayées',
            options: [
              { value: 'unpaid', label: 'Impayées' },
              { value: 'overdue', label: 'En retard' },
            ],
          },
        ]}
      />

      <Card title={`${result.total} facture(s)`}>
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucune facture"
            description="Les ventes et les factures que vous émettez apparaîtront ici."
            action={
              can(context, 'invoices.write') ? (
                <ButtonLink href="/factures/nouvelle" variant="secondary">
                  Créer une facture
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Numéro</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Payé</th>
                    <th className="px-4 py-2 text-right font-medium">Reste dû</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {result.items.map((invoice) => {
                    const overdue = isOverdue(invoice);
                    return (
                      <tr key={invoice.id}>
                        <td className="px-4 py-3 sm:px-5">
                          <Link
                            href={`/factures/${invoice.id}`}
                            className="whitespace-nowrap font-mono text-xs font-semibold text-brand-700 hover:underline"
                          >
                            {invoice.number}
                          </Link>
                          {invoice.origin === 'POS' && (
                            <p className="text-xs text-ink-400">Vente au comptoir</p>
                          )}
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                          {invoice.issueDate.toLocaleDateString('fr-FR')}
                          {invoice.dueDate && (
                            <p className={overdue ? 'text-xs text-red-600' : 'text-xs text-ink-400'}>
                              Échéance {invoice.dueDate.toLocaleDateString('fr-FR')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {invoice.customer?.name ?? 'Client de passage'}
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-3 text-right font-medium text-ink-900">
                          {formatMoney(invoice.total, currency, context.locale)}
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink-600">
                          {formatMoney(invoice.paidAmount, currency, context.locale)}
                        </td>
                        <td
                          className={`tabular whitespace-nowrap px-4 py-3 text-right font-medium ${
                            invoice.balanceDue > 0n ? 'text-amber-700' : 'text-ink-400'
                          }`}
                        >
                          {formatMoney(invoice.balanceDue, currency, context.locale)}
                        </td>
                        <td className="px-4 py-3 sm:px-5">
                          <div className="flex items-center justify-between gap-3">
                            <Badge tone={statusTone(invoice.status, overdue)}>
                              {overdue
                                ? 'En retard'
                                : INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
                            </Badge>
                            {/* Relancer un impaye est l'action la plus frequente
                                depuis cette liste : elle ouvre directement le
                                formulaire d'encaissement. */}
                            {canCollect && invoice.balanceDue > 0n && invoice.status !== 'DRAFT' && (
                              <Link
                                href={`/factures/${invoice.id}?encaisser=1`}
                                className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline"
                              >
                                Encaisser
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {result.pageCount > 1 && (
              <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
                <PageLink page={query.page - 1} query={query} disabled={query.page <= 1}>
                  Précédent
                </PageLink>
                <span className="text-ink-500">
                  Page {result.page} sur {result.pageCount}
                </span>
                <PageLink page={query.page + 1} query={query} disabled={query.page >= result.pageCount}>
                  Suivant
                </PageLink>
              </nav>
            )}
          </>
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

function PageLink({
  page,
  query,
  disabled,
  children,
}: {
  page: number;
  query: { search?: string; status?: string; filter?: string };
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <span className="text-ink-300">{children}</span>;
  const params = new URLSearchParams({ page: String(page) });
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.filter) params.set('filter', query.filter);
  return (
    <Link href={`/factures?${params}`} className="font-semibold text-brand-700 hover:underline">
      {children}
    </Link>
  );
}
