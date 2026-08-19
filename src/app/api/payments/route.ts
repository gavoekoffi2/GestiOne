import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { paymentSchema } from '@/lib/validation/commerce';
import { listPayments, recordPayment } from '@/server/services/payments';
import { getCurrencyFormat } from '@/server/currency';
import { commerceContext } from '@/server/commerce-context';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson, readQuery } from '@/server/http';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  partnerId: z.string().trim().max(64).optional(),
  invoiceId: z.string().trim().max(64).optional(),
  methodId: z.string().trim().max(64).optional(),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('payments.read');
  return jsonOk(await listPayments(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('payments.create');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, paymentSchema(currency.decimals));

  return jsonOk(await recordPayment(await commerceContext(context), input), 201);
});
