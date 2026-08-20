import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { purchaseSchema } from '@/lib/validation/finance';
import { createPurchaseOrder, listPurchaseOrders } from '@/server/services/purchases';
import { resolvePartnerReference } from '@/server/services/partners';
import { getCurrencyFormat } from '@/server/currency';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson, readQuery } from '@/server/http';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(24).optional(),
  supplierId: z.string().trim().max(64).optional(),
  unpaidOnly: z.string().optional().transform((v) => v === 'true'),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('purchases.read');
  return jsonOk(await listPurchaseOrders(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('purchases.write');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, purchaseSchema(currency.decimals));

  // Receptionner immediatement fait entrer de la marchandise en stock : c'est
  // l'operation de reception, avec sa propre permission.
  if (input.receiveNow) {
    const { requirePermission } = await import('@/server/tenant');
    requirePermission(context, 'purchases.receive');
  }

  const supplierId = await resolvePartnerReference(context.companyId, 'SUPPLIER', {
    id: input.supplierId,
    name: input.supplierName,
  });

  const order = await createPurchaseOrder(await commerceContext(context), {
    ...input,
    supplierId,
    discountRate: input.discountRate || undefined,
  });

  return jsonOk(order, 201);
});
