import type { NextRequest } from 'next/server';
import { getQuote } from '@/server/services/quotes';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

export const GET = handler(async (_request: NextRequest, { params }) => {
  const context = await requireTenantWith('quotes.read');
  const { id } = await params;
  return jsonOk(await getQuote(context.companyId, id as string));
});
