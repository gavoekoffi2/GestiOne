import type { NextRequest } from 'next/server';
import { quoteStatusSchema } from '@/lib/validation/commerce';
import { changeQuoteStatus } from '@/server/services/quotes';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('quotes.write');
  const { id } = await params;
  const { status } = await readJson(request, quoteStatusSchema);
  return jsonOk(await changeQuoteStatus(await commerceContext(context), id as string, status));
});
