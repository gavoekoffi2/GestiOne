import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentBuilder } from '@/components/commerce/document-builder';
import { loadBuilderData } from '@/components/commerce/builder-data';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Nouvelle facture' };
export const dynamic = 'force-dynamic';

export default async function NewInvoicePage() {
  const context = await requireTenantWith('invoices.write');
  const data = await loadBuilderData(context);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/factures" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux factures
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Nouvelle facture</h1>
        <p className="mt-1 text-ink-600">
          Composez la facture ligne par ligne. Tant qu&apos;elle reste en brouillon, aucun stock ne
          sort et aucune creance n&apos;est creee.
        </p>
      </div>

      <DocumentBuilder
        kind="invoice"
        endpoint="/api/invoices"
        redirectTo={(id) => `/factures/${id}`}
        canDiscount={can(context, 'sales.discount')}
        locale={context.locale}
        {...data}
      />
    </div>
  );
}
