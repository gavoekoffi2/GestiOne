import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, Card, EmptyState, Select } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { INVOICE_STATUS_LABELS, isOverdue, listInvoices, type InvoiceStatus } from '@/server/services/invoices';
import { requireTenantWith } from '@/server/tenant';

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Factures</h1>
          <p className="mt-1 text-ink-600">
            Toutes vos factures, y compris celles issues des ventes au comptoir.
          </p>
        </div>
        <Link href="/ventes" className="text-sm font-semibold text-brand-700 hover:underline">
          Nouvelle vente
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total facture" value={formatMoney(result.sums.total, currency, context.locale)} icon="receipt" />
        <Tile label="Encaisse" value={formatMoney(result.sums.paid, currency, context.locale)} icon="wallet" />
        <Tile
          label="Reste du"
          value={formatMoney(result.sums.balance, currency, context.locale)}
          icon="minus"
          tone={result.sums.balance > 0n ? 'warning' : undefined}
        />
      </div>

      <Card
        title={`${result.total} facture(s)`}
        action={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="search"
              defaultValue={query.search}
              placeholder="Numero ou client"
              aria-label="Rechercher une facture"
              className="min-h-9 rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-ink-300"
            />
            <label htmlFor="status" className="sr-only">Statut</label>
            <Select id="status" name="status" defaultValue={query.status ?? ''} className="min-h-9 text-sm">
              <option value="">Tous les statuts</option>
              {Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <label htmlFor="filter" className="sr-only">Filtre</label>
            <Select id="filter" name="filter" defaultValue={query.filter ?? ''} className="min-h-9 text-sm">
              <option value="">Toutes</option>
              <option value="unpaid">Impayees</option>
              <option value="overdue">En retard</option>
            </Select>
            <button type="submit" className="min-h-9 rounded-lg bg-ink-800 px-3 text-sm font-semibold text-white">
              Filtrer
            </button>
          </form>
        }
      >
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucune facture"
            description="Les ventes et les factures que vous emettez apparaitront ici."
          />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2 font-medium sm:px-5">Numero</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Paye</th>
                    <th className="px-4 py-2 text-right font-medium">Reste du</th>
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
                            className="font-mono text-xs font-semibold text-brand-700 hover:underline"
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
                              Echeance {invoice.dueDate.toLocaleDateString('fr-FR')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {invoice.customer?.name ?? 'Client de passage'}
                        </td>
                        <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                          {formatMoney(invoice.total, currency, context.locale)}
                        </td>
                        <td className="tabular px-4 py-3 text-right text-ink-600">
                          {formatMoney(invoice.paidAmount, currency, context.locale)}
                        </td>
                        <td
                          className={`tabular px-4 py-3 text-right font-medium ${
                            invoice.balanceDue > 0n ? 'text-amber-700' : 'text-ink-400'
                          }`}
                        >
                          {formatMoney(invoice.balanceDue, currency, context.locale)}
                        </td>
                        <td className="px-4 py-3 sm:px-5">
                          <Badge tone={statusTone(invoice.status, overdue)}>
                            {overdue
                              ? 'En retard'
                              : INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
                          </Badge>
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
                  Precedent
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
