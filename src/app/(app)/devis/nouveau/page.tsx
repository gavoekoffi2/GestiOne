import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentBuilder } from '@/components/commerce/document-builder';
import { loadBuilderData } from '@/components/commerce/builder-data';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Nouveau devis' };
export const dynamic = 'force-dynamic';

export default async function NewQuotePage() {
  const context = await requireTenantWith('quotes.write');
  const data = await loadBuilderData(context);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/devis" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux devis
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Nouveau devis</h1>
        <p className="mt-1 text-ink-600">
          Un devis est une proposition : il ne touche ni au stock, ni aux creances. Il ne vous
          engage qu&apos;a sa conversion en facture.
        </p>
      </div>

      <DocumentBuilder
        kind="quote"
        endpoint="/api/quotes"
        redirectTo={(id) => `/devis/${id}`}
        canDiscount={can(context, 'sales.discount')}
        locale={context.locale}
        {...data}
      />
    </div>
  );
}
