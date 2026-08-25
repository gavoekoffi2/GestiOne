import type { NextRequest } from 'next/server';
import { productSchema } from '@/lib/validation/catalog';
import { deleteProduct, getProduct, updateProduct } from '@/server/services/catalog';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.read');
  const { id } = await params;
  return jsonOk(await getProduct(context.companyId, id as string));
});

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.write');
  const { id } = await params;
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, productSchema(currency.decimals));
  const updated = await updateProduct(context.companyId, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Product',
    entityId: updated.id,
    summary: `Article "${updated.name}" modifié (${updated.sku})`,
    ipAddress: clientIp(request),
  });

  return jsonOk(updated);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.delete');
  const { id } = await params;
  const archived = await deleteProduct(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'Product',
    entityId: id as string,
    summary: `Article "${archived.name}" désactivé`,
    ipAddress: clientIp(request),
  });

  return jsonOk(archived);
});
