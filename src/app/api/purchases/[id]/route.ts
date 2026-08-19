import type { NextRequest } from 'next/server';
import { getPurchaseOrder } from '@/server/services/purchases';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const GET = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('purchases.read');
  const { id } = await params;
  return jsonOk(await getPurchaseOrder(context.companyId, id as string));
});
