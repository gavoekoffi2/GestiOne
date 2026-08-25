import type { NextRequest } from 'next/server';
import { productSchema } from '@/lib/validation/catalog';
import { productListQuerySchema } from '@/lib/validation/list-query';
import { createProduct, listProducts } from '@/server/services/catalog';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson, readQuery } from '@/server/http';

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('products.read');
  const query = readQuery(request, productListQuerySchema);
  return jsonOk(await listProducts(context.companyId, query));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('products.write');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, productSchema(currency.decimals));
  const created = await createProduct(context.companyId, input, context.userId);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'Product',
    entityId: created.id,
    summary: `Article "${created.name}" créé (${created.sku})`,
    ipAddress: clientIp(request),
  });

  return jsonOk(created, 201);
});
