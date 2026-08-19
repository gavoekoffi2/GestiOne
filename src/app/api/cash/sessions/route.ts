import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { openCashSchema } from '@/lib/validation/finance';
import { listCashSessions, openCashSession } from '@/server/services/cash';
import { getCurrencyFormat } from '@/server/currency';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson, readQuery } from '@/server/http';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  locationId: z.string().trim().max(64).optional(),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('cash.read');
  return jsonOk(await listCashSessions(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('cash.operate');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, openCashSchema(currency.decimals));

  return jsonOk(
    await openCashSession({ companyId: context.companyId, userId: context.userId }, input),
    201,
  );
});
