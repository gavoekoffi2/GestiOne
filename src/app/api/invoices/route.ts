import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { invoiceSchema } from '@/lib/validation/commerce';
import { createInvoice, listInvoices } from '@/server/services/invoices';
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
  unpaidOnly: z.string().optional().transform((v) => v === 'true'),
  overdueOnly: z.string().optional().transform((v) => v === 'true'),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('invoices.read');
  return jsonOk(await listInvoices(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('invoices.write');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, invoiceSchema(currency.decimals));

  const invoice = await createInvoice(await commerceContext(context), {
    ...input,
    discountAmount: input.discountAmount,
    discountRate: input.discountRate || undefined,
  });

  return jsonOk(invoice, 201);
});
