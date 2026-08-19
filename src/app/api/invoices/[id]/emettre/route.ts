import type { NextRequest } from 'next/server';
import { issueInvoice } from '@/server/services/invoices';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const POST = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('invoices.write');
  const { id } = await params;
  return jsonOk(await issueInvoice(await commerceContext(context), id as string));
});
