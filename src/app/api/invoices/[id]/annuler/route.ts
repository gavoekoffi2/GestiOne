import type { NextRequest } from 'next/server';
import { cancelSchema } from '@/lib/validation/commerce';
import { cancelInvoice } from '@/server/services/invoices';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('invoices.cancel');
  const { id } = await params;
  const { reason } = await readJson(request, cancelSchema);
  return jsonOk(await cancelInvoice(await commerceContext(context), id as string, reason));
});
