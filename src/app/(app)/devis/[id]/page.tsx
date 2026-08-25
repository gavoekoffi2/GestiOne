import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { PrintPageFormat } from '@/components/commerce/print-page-format';
import { QuoteActions } from '@/components/commerce/quote-actions';
import { ShareActions } from '@/components/commerce/share-actions';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import { getCompanyProfile } from '@/server/services/companies';
import { listLocations } from '@/server/services/locations';
import {
  QUOTE_STATUS_LABELS,
  allowedTransitions,
  canConvert,
  getQuote,
  isExpired,
  type QuoteStatus,
} from '@/server/services/quotes';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Devis' };
export const dynamic = 'force-dynamic';

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireTenantWith('quotes.read');
  const { id } = await params;

  const [quote, company, currency, locations] = await Promise.all([
    getQuote(context.companyId, id),
    getCompanyProfile(context.companyId),
    getCurrencyFormat(context.currencyCode),
    listLocations(context.companyId),
  ]);

  const expired = isExpired(quote);
  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);
  const activeLocations = locations.filter((location) => location.isActive);

  const summary = [
    company.name,
    `Devis ${quote.number} du ${quote.issueDate.toLocaleDateString('fr-FR')}`,
    quote.customer ? `Client : ${quote.customer.name}` : null,
    quote.validUntil ? `Valable jusqu'au ${quote.validUntil.toLocaleDateString('fr-FR')}` : null,
    '',
    ...quote.lines.map(
      (line) =>
        `${formatQuantity(line.quantity, context.locale)} x ${line.description} — ${money(line.lineTotal)}`,
    ),
    '',
    `Total : ${money(quote.total)}`,
    company.phone ? '' : null,
    company.phone ? `${company.name} — ${company.phone}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link href="/devis" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux devis
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Devis {quote.number}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              tone={
                expired
                  ? 'warning'
                  : quote.status === 'ACCEPTED'
                    ? 'success'
                    : quote.status === 'CONVERTED'
                      ? 'info'
                      : quote.status === 'REJECTED'
                        ? 'danger'
                        : 'neutral'
              }
            >
              {expired ? 'Expiré' : QUOTE_STATUS_LABELS[quote.status as QuoteStatus] ?? quote.status}
            </Badge>
            {quote.invoice && (
              <Link
                href={`/factures/${quote.invoice.id}`}
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                Facture {quote.invoice.number}
              </Link>
            )}
          </div>
        </div>
        <ShareActions
          title={`Devis ${quote.number}`}
          summary={summary}
          phone={quote.customer?.phone ?? ''}
        />
      </div>

      <QuoteActions
        quoteId={quote.id}
        allowedStatuses={allowedTransitions(quote.status)}
        canConvert={can(context, 'quotes.convert') && canConvert(quote)}
        canWrite={can(context, 'quotes.write')}
        statusLabels={QUOTE_STATUS_LABELS}
        defaultLocationId={quote.locationId ?? context.defaultLocationId ?? activeLocations[0]?.id ?? ''}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
      />

      <PrintPageFormat />

      <article className="doc-sheet mx-auto w-full max-w-3xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-ink-200 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-200 pb-6">
          <div>
            <h2 className="text-xl font-bold" style={{ color: company.primaryColor }}>
              {company.legalName || company.name}
            </h2>
            <div className="mt-1 space-y-0.5 text-sm text-ink-600">
              {company.addressLine && <p>{company.addressLine}</p>}
              {company.phone && <p>{company.phone}</p>}
              {company.email && <p>{company.email}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Devis</p>
            <p className="font-mono text-lg font-bold text-ink-900">{quote.number}</p>
            <dl className="mt-2 space-y-0.5 text-sm text-ink-600">
              <div className="flex justify-end gap-2">
                <dt>Date :</dt>
                <dd className="tabular">{quote.issueDate.toLocaleDateString('fr-FR')}</dd>
              </div>
              {quote.validUntil && (
                <div className="flex justify-end gap-2">
                  <dt>Valable jusqu&apos;au :</dt>
                  <dd className="tabular">{quote.validUntil.toLocaleDateString('fr-FR')}</dd>
                </div>
              )}
            </dl>
          </div>
        </header>

        {quote.customer && (
          <section className="border-b border-ink-200 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Client</p>
            <p className="mt-1 font-medium text-ink-900">{quote.customer.name}</p>
            <div className="text-sm text-ink-600">
              {quote.customer.companyName && <p>{quote.customer.companyName}</p>}
              {quote.customer.phone && <p>{quote.customer.phone}</p>}
            </div>
          </section>
        )}

        <div className="overflow-x-auto py-5">
          <table className="doc-table w-full min-w-[30rem] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[14%]" />
              <col className="w-[21%]" />
              <col className="w-[21%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
                <th className="py-3 pr-6 font-medium">Désignation</th>
                <th className="px-6 py-3 text-right font-medium">Qte</th>
                <th className="px-6 py-3 text-right font-medium">P.U.</th>
                <th className="py-3 pl-6 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {quote.lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-3 pr-6 text-ink-900">{line.description}</td>
                  <td className="tabular px-6 py-3 text-right text-ink-700">
                    {formatQuantity(line.quantity, context.locale)}
                  </td>
                  <td className="tabular px-6 py-3 text-right text-ink-700">
                    {money(line.unitPrice)}
                  </td>
                  <td className="tabular py-3 pl-6 text-right font-medium text-ink-900">
                    {money(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-ink-200 pt-4">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <Row label="Sous-total" value={money(quote.subtotal)} />
            {quote.discountAmount > 0n && (
              <Row label="Remise" value={`- ${money(quote.discountAmount)}`} />
            )}
            {quote.taxTotal > 0n && <Row label="Taxes" value={money(quote.taxTotal)} />}
            <div className="border-t border-ink-300 pt-1">
              <Row label="Total" value={money(quote.total)} strong />
            </div>
          </dl>
        </div>

        {(quote.notes || quote.terms || company.documentFooter) && (
          <footer className="mt-4 space-y-2 border-t border-ink-200 pt-4 text-sm text-ink-600">
            {quote.notes && <p>{quote.notes}</p>}
            {quote.terms && <p className="text-xs">{quote.terms}</p>}
            {company.documentFooter && (
              <p className="text-xs text-ink-400">{company.documentFooter}</p>
            )}
          </footer>
        )}
      </article>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink-900' : 'text-ink-600'}>{label}</dt>
      <dd className={`tabular ${strong ? 'text-lg font-bold text-ink-900' : 'text-ink-800'}`}>
        {value}
      </dd>
    </div>
  );
}
