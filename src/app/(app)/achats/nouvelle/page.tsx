import type { Metadata } from 'next';
import Link from 'next/link';
import { PurchaseBuilder } from '@/components/finance/purchase-builder';
import { toDecimalString } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { listProducts } from '@/server/services/catalog';
import { listPartners } from '@/server/services/partners';
import { listLocations } from '@/server/services/locations';
import { listTaxRates } from '@/server/services/commerce-setup';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Nouvel achat' };
export const dynamic = 'force-dynamic';

export default async function NewPurchasePage() {
  const context = await requireTenantWith('purchases.write');

  const [products, suppliers, locations, taxRates, currency] = await Promise.all([
    listProducts(context.companyId, { page: 1, pageSize: 500 }),
    listPartners(context.companyId, 'SUPPLIER', { page: 1, pageSize: 500 }),
    listLocations(context.companyId),
    listTaxRates(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/achats" className="text-sm font-medium text-brand-700 hover:underline">
          ← Retour aux achats
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Nouvel achat</h1>
        <p className="mt-1 text-ink-600">
          Enregistrez un achat deja livre, ou passez une commande a receptionner plus tard.
        </p>
      </div>

      <PurchaseBuilder
        currency={currency}
        locale={context.locale}
        canReceive={can(context, 'purchases.receive')}
        defaultLocationId={context.defaultLocationId ?? activeLocations[0]?.id ?? ''}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        suppliers={suppliers.items.map((supplier) => ({
          id: supplier.id,
          label: supplier.name,
          hint: [supplier.code, supplier.phone].filter(Boolean).join(' · '),
        }))}
        taxRates={taxRates.map((tax) => ({
          id: tax.id,
          label: `${tax.name} (${(tax.rate / 100).toString().replace('.', ',')} %)`,
          rate: tax.rate,
        }))}
        products={products.items.map((product) => ({
          id: product.id,
          label: product.name,
          unitCost: toDecimalString(product.costPrice, currency.decimals),
        }))}
      />
    </div>
  );
}
