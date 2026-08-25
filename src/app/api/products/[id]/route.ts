import type { NextRequest } from 'next/server';
import { productSchema } from '@/lib/validation/catalog';
import { deleteProduct, getProduct, updateProduct } from '@/server/services/catalog';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { can, requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

/**
 * Le prix d'achat revele la marge de l'entreprise : il ne quitte le serveur que
 * pour un utilisateur qui a le droit de le voir. Le masquer dans l'interface ne
 * suffisait pas — la valeur partait quand meme dans la reponse.
 */
function withoutCost<T extends { costPrice: bigint }>(product: T): Omit<T, 'costPrice'> {
  const { costPrice: _hidden, ...rest } = product;
  return rest;
}

export const GET = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.read');
  const { id } = await params;
  const product = await getProduct(context.companyId, id as string);
  return jsonOk(can(context, 'products.cost.read') ? product : withoutCost(product));
});

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.write');
  const { id } = await params;
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, productSchema(currency.decimals));

  // Un utilisateur qui ne voit pas le prix d'achat ne peut pas non plus
  // l'ecraser : la valeur enregistree est reprise telle quelle.
  const existing = await getProduct(context.companyId, id as string);
  const costPrice = can(context, 'products.cost.read')
    ? (input.costPrice ?? existing.costPrice)
    : existing.costPrice;

  const updated = await updateProduct(context.companyId, id as string, { ...input, costPrice });

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
