import type { NextRequest } from 'next/server';
import { receiveSchema } from '@/lib/validation/finance';
import { receiveOrder } from '@/server/services/purchases';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('purchases.receive');
  const { id } = await params;
  const input = await readJson(request, receiveSchema);
  return jsonOk(await receiveOrder(await commerceContext(context), id as string, input));
});
