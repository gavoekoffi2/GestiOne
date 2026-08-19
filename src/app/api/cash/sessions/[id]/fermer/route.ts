import type { NextRequest } from 'next/server';
import { closeCashSchema } from '@/lib/validation/finance';
import { closeCashSession } from '@/server/services/cash';
import { getCurrencyFormat } from '@/server/currency';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('cash.operate');
  const { id } = await params;
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, closeCashSchema(currency.decimals));

  return jsonOk(
    await closeCashSession(
      { companyId: context.companyId, userId: context.userId },
      id as string,
      input,
    ),
  );
});
