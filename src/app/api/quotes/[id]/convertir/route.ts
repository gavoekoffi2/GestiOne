import type { NextRequest } from 'next/server';
import { convertQuoteSchema } from '@/lib/validation/commerce';
import { convertQuoteToInvoice } from '@/server/services/quotes';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('quotes.convert');
  const { id } = await params;
  const options = await readJson(request, convertQuoteSchema);
  const invoice = await convertQuoteToInvoice(await commerceContext(context), id as string, options);
  return jsonOk({ invoiceId: invoice.id, number: invoice.number }, 201);
});
