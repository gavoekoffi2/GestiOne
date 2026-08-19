import type { NextRequest } from 'next/server';
import { cancelSchema } from '@/lib/validation/commerce';
import { cancelPurchaseOrder } from '@/server/services/purchases';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('purchases.write');
  const { id } = await params;
  const { reason } = await readJson(request, cancelSchema);
  return jsonOk(await cancelPurchaseOrder(await commerceContext(context), id as string, reason));
});
