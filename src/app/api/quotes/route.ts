import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { quoteSchema } from '@/lib/validation/commerce';
import { createQuote, listQuotes } from '@/server/services/quotes';
import { getCurrencyFormat } from '@/server/currency';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson, readQuery } from '@/server/http';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(24).optional(),
  customerId: z.string().trim().max(64).optional(),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('quotes.read');
  return jsonOk(await listQuotes(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('quotes.write');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, quoteSchema(currency.decimals));

  const quote = await createQuote(await commerceContext(context), {
    ...input,
    discountRate: input.discountRate || undefined,
  });

  return jsonOk(quote, 201);
});
