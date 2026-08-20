import type { NextRequest } from 'next/server';
import { saleSchema } from '@/lib/validation/commerce';
import { recordSale } from '@/server/services/sales';
import { resolvePartnerReference } from '@/server/services/partners';
import { getCurrencyFormat } from '@/server/currency';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('sales.create');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, saleSchema(currency.decimals));

  // Une remise exige sa propre permission : un caissier ne doit pas pouvoir
  // brader la marchandise sans que ce soit un choix de l'entreprise.
  const hasDiscount =
    (input.discountAmount !== undefined && input.discountAmount > 0n) ||
    (input.discountRate ?? 0) > 0 ||
    input.lines.some((line) => (line.discountRate ?? 0) > 0);

  if (hasDiscount) {
    const { requirePermission } = await import('@/server/tenant');
    requirePermission(context, 'sales.discount');
  }

  // Le client peut n'exister que sous forme de nom tape pendant la vente.
  const customerId = await resolvePartnerReference(context.companyId, 'CUSTOMER', {
    id: input.customerId,
    name: input.customerName,
  });

  const sale = await recordSale(await commerceContext(context), {
    ...input,
    customerId,
    discountRate: input.discountRate || undefined,
  });

  return jsonOk(sale, 201);
});
