import { toDecimalString } from '@/lib/money';
import { getCurrencyFormat } from '@/server/currency';
import { listProducts } from '@/server/services/catalog';
import { listPartners } from '@/server/services/partners';
import { listLocations } from '@/server/services/locations';
import { listTaxRates } from '@/server/services/commerce-setup';
import type { TenantContext } from '@/server/tenant';

/**
 * Donnees communes aux ecrans de creation de devis et de facture : catalogue,
 * clients, points de vente, taux de taxe et format de devise.
 */
export async function loadBuilderData(context: TenantContext) {
  const [products, customers, locations, taxRates, currency] = await Promise.all([
    listProducts(context.companyId, { page: 1, pageSize: 500 }),
    listPartners(context.companyId, 'CUSTOMER', { page: 1, pageSize: 500 }),
    listLocations(context.companyId),
    listTaxRates(context.companyId),
    getCurrencyFormat(context.currencyCode),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);

  return {
    currency,
    defaultLocationId: context.defaultLocationId ?? activeLocations[0]?.id ?? '',
    locations: activeLocations.map((location) => ({ id: location.id, label: location.name })),
    customers: customers.items.map((customer) => ({
      id: customer.id,
      label: customer.name,
      hint: [customer.code, customer.phone].filter(Boolean).join(' · '),
    })),
    taxRates: taxRates.map((tax) => ({
      id: tax.id,
      label: `${tax.name} (${(tax.rate / 100).toString().replace('.', ',')} %)`,
      rate: tax.rate,
    })),
    products: products.items.map((product) => ({
      id: product.id,
      label: product.name,
      unitPrice: toDecimalString(product.salePrice, currency.decimals),
      unitPriceMinor: product.salePrice.toString(),
    })),
  };
}
