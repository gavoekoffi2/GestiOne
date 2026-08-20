import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { QuoteActions } from '@/components/commerce/quote-actions';
import { ShareActions } from '@/components/commerce/share-actions';
import { InvoiceDocument } from '@/components/commerce/invoice-document';
import { PrintControls } from '@/components/commerce/print-controls';
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
              {expired ? 'Expire' : QUOTE_STATUS_LABELS[quote.status as QuoteStatus] ?? quote.status}
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
        <div className="flex flex-wrap items-end gap-2">
          <ShareActions
            title={`Devis ${quote.number}`}
            summary={summary}
            phone={quote.customer?.phone ?? ''}
          />
          <PrintControls defaultFormat={company.documentFormat} />
        </div>
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

      {/* Meme document que la facture : un devis accepte devient une facture,
          les deux doivent se ressembler pour que le client s'y retrouve. */}
      <InvoiceDocument
        kind="Devis"
        number={quote.number}
        issueDate={quote.issueDate}
        dueDate={quote.validUntil}
        locationName={null}
        company={{
          name: company.name,
          legalName: company.legalName,
          logoUrl: company.logoUrl,
          addressLine: company.addressLine,
          city: company.city,
          countryCode: company.countryCode,
          phone: company.phone,
          email: company.email,
          website: company.website,
          taxNumber: company.taxNumber,
          primaryColor: company.primaryColor,
          documentFooter: company.documentFooter,
          paymentTerms: company.paymentTerms,
        }}
        customer={
          quote.customer
            ? {
                name: quote.customer.name,
                companyName: quote.customer.companyName,
                addressLine: quote.customer.addressLine,
                city: quote.customer.city,
                phone: quote.customer.phone,
                taxNumber: quote.customer.taxNumber,
              }
            : null
        }
        lines={quote.lines.map((line) => ({
          id: line.id,
          description: line.description,
          sku: line.product?.sku ?? null,
          unitSymbol: line.product?.unit?.symbol ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountRate: line.discountRate,
          taxAmount: null,
          lineTotal: line.lineTotal,
        }))}
        subtotal={quote.subtotal}
        discountAmount={quote.discountAmount}
        taxTotal={quote.taxTotal}
        total={quote.total}
        paidAmount={0n}
        balanceDue={0n}
        payments={[]}
        notes={quote.notes}
        terms={quote.terms}
        cancelledLabel={null}
        currency={currency}
        locale={context.locale}
      />
    </div>
  );
}
