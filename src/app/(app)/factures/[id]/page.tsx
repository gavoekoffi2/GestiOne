import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { InvoiceActions } from '@/components/commerce/invoice-actions';
import { ShareActions } from '@/components/commerce/share-actions';
import { InvoiceDocument } from '@/components/commerce/invoice-document';
import { PrintControls } from '@/components/commerce/print-controls';
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
    invoice.paidAmount > 0n ? `Paye : ${money(invoice.paidAmount)}` : null,
    invoice.balanceDue > 0n ? `Reste a payer : ${money(invoice.balanceDue)}` : null,
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
        <div className="flex flex-wrap items-end gap-2">
          <ShareActions
            title={`Facture ${invoice.number}`}
            summary={summary}
            phone={invoice.customer?.phone ?? ''}
          />
          <PrintControls defaultFormat={company.documentFormat} />
        </div>
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
      <InvoiceDocument
        kind={invoice.origin === 'POS' ? 'Recu' : 'Facture'}
        number={invoice.number}
        issueDate={invoice.issueDate}
        dueDate={invoice.dueDate}
        locationName={invoice.location?.name ?? null}
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
          invoice.customer
            ? {
                name: invoice.customer.name,
                companyName: invoice.customer.companyName,
                addressLine: invoice.customer.addressLine,
                city: invoice.customer.city,
                phone: invoice.customer.phone,
                taxNumber: invoice.customer.taxNumber,
              }
            : null
        }
        lines={invoice.lines.map((line) => ({
          id: line.id,
          description: line.description,
          sku: line.product?.sku ?? null,
          unitSymbol: line.product?.unit?.symbol ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountRate: line.discountRate,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
        }))}
        subtotal={invoice.subtotal}
        discountAmount={invoice.discountAmount}
        taxTotal={invoice.taxTotal}
        total={invoice.total}
        paidAmount={invoice.paidAmount}
        balanceDue={invoice.balanceDue}
        payments={invoice.payments.map((payment) => ({
          id: payment.id,
          label: `${payment.paidAt.toLocaleDateString('fr-FR')} · ${payment.method?.name ?? 'Non precise'}${payment.reference ? ` · ${payment.reference}` : ''}`,
          amount: payment.amount,
        }))}
        notes={invoice.notes}
        terms={invoice.terms}
        cancelledLabel={
          invoice.status === 'CANCELLED'
            ? `Facture annulee${invoice.cancelReason ? ` — ${invoice.cancelReason}` : ''}`
            : null
        }
        currency={currency}
        locale={context.locale}
      />
    </div>
  );
}
