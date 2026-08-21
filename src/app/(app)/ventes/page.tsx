import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/primitives';
import { PointOfSale } from '@/components/commerce/pos';
import { formatMoney, toDecimalString } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { listProducts } from '@/server/services/catalog';
import { listPartners } from '@/server/services/partners';
import { listLocations } from '@/server/services/locations';
import { listPaymentMethods, listTaxRates } from '@/server/services/commerce-setup';
import { listStock } from '@/server/services/stock-query';
import { can, requireTenantWith } from '@/server/tenant';

export const metadata: Metadata = { title: 'Vente' };
export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const context = await requireTenantWith('sales.create');

  const [products, customers, methods, taxRates, locations, currency] = await Promise.all([
    listProducts(context.companyId, { page: 1, pageSize: 500 }),
    listPartners(context.companyId, 'CUSTOMER', { page: 1, pageSize: 500 }),
    listPaymentMethods(context.companyId),
    listTaxRates(context.companyId),
    listLocations(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);
  const defaultLocationId = context.defaultLocationId ?? activeLocations[0]?.id ?? '';

  // Le stock affiche est celui du point de vente de l'utilisateur : afficher un
  // total consolide induirait en erreur un caissier qui n'a pas la marchandise
  // sous la main.
  const stock = await listStock(context.companyId, {
    page: 1,
    pageSize: 1000,
    locationId: defaultLocationId || undefined,
  });
  const stockByProduct = new Map(stock.items.map((row) => [row.productId, row.quantity]));

  if (activeLocations.length === 0) {
    return (
      <Alert tone="warning" title="Aucun point de vente actif">
        Declarez au moins un point de vente avant d&apos;enregistrer des ventes.{' '}
        <Link href="/parametres/points-de-vente" className="font-semibold underline">
          Configurer les points de vente
        </Link>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Vente</h1>
          <p className="mt-1 text-ink-600">
            Composez le panier, encaissez, remettez le recu. Le stock et les creances se mettent a
            jour automatiquement.
          </p>
        </div>
        <Link href="/factures" className="text-sm font-semibold text-brand-700 hover:underline">
          Voir les factures
        </Link>
      </div>

      <PointOfSale
        currency={currency}
        locale={context.locale}
        canDiscount={can(context, 'sales.discount')}
        defaultLocationId={defaultLocationId}
        locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
        customers={customers.items.map((customer) => ({
          id: customer.id,
          label: customer.name,
          hint: [customer.code, customer.phone].filter(Boolean).join(' · '),
        }))}
        methods={methods.map((method) => ({
          id: method.id,
          label: method.name,
          isCredit: method.isCredit,
          requiresReference: method.requiresReference,
        }))}
        taxRates={taxRates.map((tax) => ({
          id: tax.id,
          label: `${tax.name} (${(tax.rate / 100).toString().replace('.', ',')} %)`,
          rate: tax.rate,
        }))}
        products={products.items.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode ?? '',
          unitSymbol: product.unit?.symbol ?? '',
          salePriceLabel: formatMoney(product.salePrice, currency, context.locale),
          salePrice: toDecimalString(product.salePrice, currency.decimals),
          salePriceMinor: product.salePrice.toString(),
          kind: product.kind === 'SERVICE' ? ('SERVICE' as const) : ('GOOD' as const),
          trackStock: product.trackStock,
          stock: (stockByProduct.get(product.id) ?? 0n).toString(),
          imageUrl: product.imageUrl ?? '',
        }))}
      />
    </div>
  );
}
