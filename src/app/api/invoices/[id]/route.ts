import type { NextRequest } from 'next/server';
import { getInvoice } from '@/server/services/invoices';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const GET = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('invoices.read');
  const { id } = await params;
  return jsonOk(await getInvoice(context.companyId, id as string));
});
