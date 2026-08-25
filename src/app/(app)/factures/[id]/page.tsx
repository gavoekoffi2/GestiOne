import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { InvoiceActions } from '@/components/commerce/invoice-actions';
import { ShareActions } from '@/components/commerce/share-actions';
import { countryLabel } from '@/lib/countries';
import { formatMoney, toDecimalString } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { getCurrencyFormat } from '@/server/currency';
import { getCompanyProfile } from '@/server/services/companies';
import { listPaymentMethods } from '@/server/services/commerce-setup';
import {
  INVOICE_STATUS_LABELS,
  getInvoice,
  isOverdue,
  type InvoiceStatus,
} from '@/server/services/invoices';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Facture' };
export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireTenantWith('invoices.read');
  const { id } = await params;

  const [invoice, company, currency, methods] = await Promise.all([
    getInvoice(context.companyId, id),
    getCompanyProfile(context.companyId),
    getCurrencyFormat(context.currencyCode),
    listPaymentMethods(context.companyId),
  ]);

  const overdue = isOverdue(invoice);
  const money = (amount: bigint) => formatMoney(amount, currency, context.locale);

  // Recapitulatif texte, utilise pour le partage (WhatsApp, courriel, SMS).
  // Volontairement lisible tel quel : le destinataire n'a rien a ouvrir.
  const summary = [
    `${company.name}`,
    `Facture ${invoice.number} du ${invoice.issueDate.toLocaleDateString('fr-FR')}`,
    invoice.customer ? `Client : ${invoice.customer.name}` : null,
    '',
    ...invoice.lines.map(
      (line) =>
        `${formatQuantity(line.quantity, context.locale)} x ${line.description} — ${money(line.lineTotal)}`,
    ),
    '',
    `Total : ${money(invoice.total)}`,
    invoice.paidAmount > 0n ? `Payé : ${money(invoice.paidAmount)}` : null,
    invoice.balanceDue > 0n ? `Reste à payer : ${money(invoice.balanceDue)}` : null,
    company.phone ? `` : null,
    company.phone ? `${company.name} — ${company.phone}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link href="/factures" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux factures
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Facture {invoice.number}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              tone={
                overdue
                  ? 'danger'
                  : invoice.status === 'PAID'
                    ? 'success'
                    : invoice.status === 'PARTIALLY_PAID'
                      ? 'warning'
                      : invoice.status === 'CANCELLED'
                        ? 'neutral'
                        : 'info'
              }
            >
              {overdue
                ? 'En retard'
                : INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
            </Badge>
            {invoice.origin === 'POS' && <Badge>Vente au comptoir</Badge>}
          </div>
        </div>
        <ShareActions
          title={`Facture ${invoice.number}`}
          summary={summary}
          phone={invoice.customer?.phone ?? ''}
        />
      </div>

      <InvoiceActions
        invoiceId={invoice.id}
        status={invoice.status}
        balanceDueText={toDecimalString(invoice.balanceDue, currency.decimals)}
        balanceDueLabel={money(invoice.balanceDue)}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        canPay={can(context, 'payments.create')}
        canIssue={can(context, 'invoices.write')}
        canCancel={can(context, 'invoices.cancel')}
        canDeletePayment={can(context, 'payments.delete')}
        methods={methods.map((method) => ({
          id: method.id,
          label: method.name,
          isCredit: method.isCredit,
          requiresReference: method.requiresReference,
        }))}
        payments={invoice.payments.map((payment) => ({
          id: payment.id,
          label: `${payment.number} · ${money(payment.amount)} · ${payment.paidAt.toLocaleDateString('fr-FR')}`,
        }))}
      />

      {/* Le document imprimable proprement dit. */}
      <article className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-ink-200 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-200 pb-6">
          <div>
            <h2 className="text-xl font-bold" style={{ color: company.primaryColor }}>
              {company.legalName || company.name}
            </h2>
            <div className="mt-1 space-y-0.5 text-sm text-ink-600">
              {company.addressLine && <p>{company.addressLine}</p>}
              {(company.city || company.countryCode) && (
                <p>{[company.city, countryLabel(company.countryCode)].filter(Boolean).join(', ')}</p>
              )}
              {company.phone && <p>{company.phone}</p>}
              {company.email && <p>{company.email}</p>}
              {company.taxNumber && <p>Identifiant fiscal : {company.taxNumber}</p>}
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Facture</p>
            <p className="font-mono text-lg font-bold text-ink-900">{invoice.number}</p>
            <dl className="mt-2 space-y-0.5 text-sm text-ink-600">
              <div className="flex justify-end gap-2">
                <dt>Date :</dt>
                <dd className="tabular">{invoice.issueDate.toLocaleDateString('fr-FR')}</dd>
              </div>
              {invoice.dueDate && (
                <div className="flex justify-end gap-2">
                  <dt>Échéance :</dt>
                  <dd className="tabular">{invoice.dueDate.toLocaleDateString('fr-FR')}</dd>
                </div>
              )}
              {invoice.location && (
                <div className="flex justify-end gap-2">
                  <dt>Point de vente :</dt>
                  <dd>{invoice.location.name}</dd>
                </div>
              )}
            </dl>
          </div>
        </header>

        {invoice.customer && (
          <section className="border-b border-ink-200 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Client</p>
            <p className="mt-1 font-medium text-ink-900">{invoice.customer.name}</p>
            <div className="text-sm text-ink-600">
              {invoice.customer.companyName && <p>{invoice.customer.companyName}</p>}
              {invoice.customer.addressLine && <p>{invoice.customer.addressLine}</p>}
              {invoice.customer.city && <p>{invoice.customer.city}</p>}
              {invoice.customer.phone && <p>{invoice.customer.phone}</p>}
              {invoice.customer.taxNumber && <p>Identifiant fiscal : {invoice.customer.taxNumber}</p>}
            </div>
          </section>
        )}

        <div className="-mx-2 overflow-x-auto py-4">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-2 py-2 font-medium">Désignation</th>
                <th className="px-2 py-2 text-right font-medium">Qte</th>
                <th className="px-2 py-2 text-right font-medium">P.U.</th>
                {invoice.lines.some((line) => line.discountRate > 0) && (
                  <th className="px-2 py-2 text-right font-medium">Remise</th>
                )}
                {invoice.taxTotal > 0n && (
                  <th className="px-2 py-2 text-right font-medium">Taxe</th>
                )}
                <th className="px-2 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-2 py-2">
                    <p className="text-ink-900">{line.description}</p>
                    {line.product?.sku && (
                      <p className="font-mono text-xs text-ink-400">{line.product.sku}</p>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-700">
                    {formatQuantity(line.quantity, context.locale)}
                    {line.product?.unit?.symbol && (
                      <span className="ml-1 text-xs text-ink-400">{line.product.unit.symbol}</span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-ink-700">
                    {money(line.unitPrice)}
                  </td>
                  {invoice.lines.some((entry) => entry.discountRate > 0) && (
                    <td className="tabular px-2 py-2 text-right text-ink-600">
                      {line.discountRate > 0
                        ? `${(line.discountRate / 100).toString().replace('.', ',')} %`
                        : '—'}
                    </td>
                  )}
                  {invoice.taxTotal > 0n && (
                    <td className="tabular px-2 py-2 text-right text-ink-600">
                      {line.taxAmount > 0n ? money(line.taxAmount) : '—'}
                    </td>
                  )}
                  <td className="tabular px-2 py-2 text-right font-medium text-ink-900">
                    {money(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-ink-200 pt-4">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <Row label="Sous-total" value={money(invoice.subtotal)} />
            {invoice.discountAmount > 0n && (
              <Row label="Remise" value={`- ${money(invoice.discountAmount)}`} />
            )}
            {invoice.taxTotal > 0n && <Row label="Taxes" value={money(invoice.taxTotal)} />}
            <div className="border-t border-ink-300 pt-1">
              <Row label="Total" value={money(invoice.total)} strong />
            </div>
            {invoice.paidAmount > 0n && <Row label="Déjà payé" value={money(invoice.paidAmount)} />}
            {invoice.balanceDue > 0n && (
              <Row label="Reste à payer" value={money(invoice.balanceDue)} strong />
            )}
          </dl>
        </div>

        {invoice.payments.length > 0 && (
          <section className="border-t border-ink-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Règlements</p>
            <ul className="mt-2 space-y-1 text-sm text-ink-600">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {payment.paidAt.toLocaleDateString('fr-FR')} · {payment.method?.name ?? 'Non précisé'}
                    {payment.reference && ` · ${payment.reference}`}
                  </span>
                  <span className="tabular font-medium text-ink-800">{money(payment.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(invoice.notes || invoice.terms || company.paymentTerms || company.documentFooter) && (
          <footer className="mt-4 space-y-2 border-t border-ink-200 pt-4 text-sm text-ink-600">
            {invoice.notes && <p>{invoice.notes}</p>}
            {(invoice.terms || company.paymentTerms) && (
              <p className="text-xs">{invoice.terms || company.paymentTerms}</p>
            )}
            {company.documentFooter && (
              <p className="text-xs text-ink-400">{company.documentFooter}</p>
            )}
          </footer>
        )}

        {invoice.status === 'CANCELLED' && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
            Facture annulée{invoice.cancelReason ? ` — ${invoice.cancelReason}` : ''}
          </p>
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
