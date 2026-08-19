import type { NextRequest } from 'next/server';
import { cancelSchema } from '@/lib/validation/commerce';
import { deletePayment } from '@/server/services/payments';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('payments.delete');
  const { id } = await params;
  const { reason } = await readJson(request, cancelSchema);
  await deletePayment(await commerceContext(context), id as string, reason);
  return jsonOk({ id });
});
