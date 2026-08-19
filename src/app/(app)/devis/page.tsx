import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Badge, ButtonLink, Card, EmptyState, Select } from '@/components/ui/primitives';
import { formatMoney } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { QUOTE_STATUS_LABELS, isExpired, listQuotes, type QuoteStatus } from '@/server/services/quotes';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Devis' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(24).optional(),
});

function tone(status: string, expired: boolean) {
  if (expired) return 'warning' as const;
  if (status === 'ACCEPTED') return 'success' as const;
  if (status === 'CONVERTED') return 'info' as const;
  if (status === 'REJECTED') return 'danger' as const;
  return 'neutral' as const;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('quotes.read');
  const raw = await searchParams;
  const query = querySchema.parse({
    page: raw.page ?? 1,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  });

  const [result, currency] = await Promise.all([
    listQuotes(context.companyId, {
      page: query.page,
      pageSize: PAGE_SIZE,
      search: query.search,
      status: query.status || undefined,
    }),
    getCurrencyFormat(context.currencyCode),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Devis</h1>
          <p className="mt-1 text-ink-600">
            Vos propositions commerciales. Un devis accepte se convertit en facture en un clic.
          </p>
        </div>
        {can(context, 'quotes.write') && (
          <ButtonLink href="/devis/nouveau">Nouveau devis</ButtonLink>
        )}
      </div>

      <Card
        title={`${result.total} devis`}
        action={
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="search"
              defaultValue={query.search}
              placeholder="Numero ou client"
              aria-label="Rechercher un devis"
              className="min-h-9 rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-ink-300"
            />
            <label htmlFor="status" className="sr-only">Statut</label>
            <Select id="status" name="status" defaultValue={query.status ?? ''} className="min-h-9 text-sm">
              <option value="">Tous les statuts</option>
              {Object.entries(QUOTE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <button type="submit" className="min-h-9 rounded-lg bg-ink-800 px-3 text-sm font-semibold text-white">
              Filtrer
            </button>
          </form>
        }
      >
        {result.items.length === 0 ? (
          <EmptyState
            title="Aucun devis"
            description="Creez un devis pour proposer un prix a un client avant de facturer."
            action={
              can(context, 'quotes.write') ? (
                <ButtonLink href="/devis/nouveau" variant="secondary">
                  Creer un devis
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium sm:px-5">Numero</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {result.items.map((quote) => {
                  const expired = isExpired(quote);
                  return (
                    <tr key={quote.id}>
                      <td className="px-4 py-3 sm:px-5">
                        <Link
                          href={`/devis/${quote.id}`}
                          className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                        >
                          {quote.number}
                        </Link>
                        {quote.invoice && (
                          <p className="text-xs text-ink-400">Facture {quote.invoice.number}</p>
                        )}
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-ink-600">
                        {quote.issueDate.toLocaleDateString('fr-FR')}
                        {quote.validUntil && (
                          <p className={expired ? 'text-xs text-amber-600' : 'text-xs text-ink-400'}>
                            Valide jusqu&apos;au {quote.validUntil.toLocaleDateString('fr-FR')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-700">{quote.customer?.name ?? '—'}</td>
                      <td className="tabular px-4 py-3 text-right font-medium text-ink-900">
                        {formatMoney(quote.total, currency, context.locale)}
                      </td>
                      <td className="px-4 py-3 sm:px-5">
                        <Badge tone={tone(quote.status, expired)}>
                          {expired
                            ? 'Expire'
                            : QUOTE_STATUS_LABELS[quote.status as QuoteStatus] ?? quote.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
