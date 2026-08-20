import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMoney, toDecimalString } from '@/lib/money';
import { formatQuantity, toQuantityString } from '@/lib/quantity';
import { productListQuerySchema } from '@/lib/validation/list-query';
import { getCurrencyFormat } from '@/server/currency';
import { countProducts, listCategories, listProducts, listUnits } from '@/server/services/catalog';
import { listPartners } from '@/server/services/partners';
import { listLocations } from '@/server/services/locations';
import { can, requireTenantWith } from '@/server/tenant';
import { ProductManager } from '@/components/catalog/product-manager';

export const metadata: Metadata = { title: 'Produits et services' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantWith('products.read');
  const raw = await searchParams;
  const query = productListQuerySchema.parse({
    page: raw.page ?? 1,
    pageSize: 25,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    includeInactive: raw.includeInactive,
    categoryId: typeof raw.categoryId === 'string' ? raw.categoryId : undefined,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
  });

  const [result, counts, categories, units, suppliers, locations, currency] = await Promise.all([
    listProducts(context.companyId, query),
    countProducts(context.companyId),
    listCategories(context.companyId),
    listUnits(context.companyId),
    listPartners(context.companyId, 'SUPPLIER', { page: 1, pageSize: 200 }),
    listLocations(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  // Le prix d'achat est une donnee sensible : un commercial ou un caissier ne
  // doit pas pouvoir deduire la marge de l'entreprise.
  const canSeeCost = can(context, 'products.cost.read');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Produits et services</h1>
          <p className="mt-1 text-ink-600">
            Votre catalogue : ce que vous vendez, a quel prix, et dans quelle unite.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {counts.goods} produit(s) · {counts.services} service(s)
            {counts.inactive > 0 ? ` · ${counts.inactive} inactif(s)` : ''}
          </p>
        </div>
        <Link
          href="/produits/organisation"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Categories et unites
        </Link>
      </div>

      <ProductManager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        currency={{ symbol: currency.symbol, decimals: currency.decimals }}
        canWrite={can(context, 'products.write')}
        canDelete={can(context, 'products.delete')}
        canSeeCost={canSeeCost}
        categories={categories.map((category) => ({
          id: category.id,
          label: category.parent ? `${category.parent.name} › ${category.name}` : category.name,
        }))}
        units={units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))}
        suppliers={suppliers.items.map((supplier) => ({
          id: supplier.id,
          label: supplier.name,
        }))}
        locations={locations.filter((location) => location.isActive).map((location) => ({
          id: location.id,
          label: location.name,
        }))}
        rows={result.items.map((item) => {
          const margin = item.salePrice - item.costPrice;
          return {
            id: item.id,
            kind: item.kind === 'SERVICE' ? ('SERVICE' as const) : ('GOOD' as const),
            name: item.name,
            sku: item.sku,
            barcode: item.barcode ?? '',
            description: item.description ?? '',
            categoryId: item.categoryId ?? '',
            categoryName: item.category?.name ?? '',
            unitId: item.unitId ?? '',
            unitSymbol: item.unit?.symbol ?? '',
            supplierId: item.supplierId ?? '',
            supplierName: item.supplier?.name ?? '',
            costPrice: toDecimalString(item.costPrice, currency.decimals),
            salePrice: toDecimalString(item.salePrice, currency.decimals),
            wholesalePrice:
              item.wholesalePrice === null
                ? ''
                : toDecimalString(item.wholesalePrice, currency.decimals),
            wholesaleFrom:
              item.wholesaleFrom === null ? '' : formatQuantity(item.wholesaleFrom, 'en'),
            specialPrice:
              item.specialPrice === null
                ? ''
                : toDecimalString(item.specialPrice, currency.decimals),
            minStock: toQuantityString(item.minStock),
            isActive: item.isActive,
            costPriceLabel: canSeeCost
              ? formatMoney(item.costPrice, currency, context.locale)
              : '',
            salePriceLabel: formatMoney(item.salePrice, currency, context.locale),
            marginLabel:
              canSeeCost && item.costPrice > 0n
                ? formatMoney(margin, currency, context.locale)
                : null,
          };
        })}
      />
    </div>
  );
}
