import type { NextRequest } from 'next/server';
import { placeOrder } from '@/server/services/purchases';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const POST = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('purchases.write');
  const { id } = await params;
  return jsonOk(await placeOrder(await commerceContext(context), id as string));
});
