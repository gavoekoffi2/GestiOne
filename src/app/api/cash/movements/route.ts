import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { cashMovementSchema } from '@/lib/validation/finance';
import { listCashMovements, recordCashMovement } from '@/server/services/cash';
import { getCurrencyFormat } from '@/server/currency';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson, readQuery } from '@/server/http';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  locationId: z.string().trim().max(64).optional(),
  sessionId: z.string().trim().max(64).optional(),
});

export const GET = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('cash.read');
  return jsonOk(await listCashMovements(context.companyId, readQuery(request, listSchema)));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('cash.operate');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, cashMovementSchema(currency.decimals));

  return jsonOk(
    await recordCashMovement({ companyId: context.companyId, userId: context.userId }, input),
    201,
  );
});
