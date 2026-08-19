import type { NextRequest } from 'next/server';
import { stockEntrySchema } from '@/lib/validation/stock';
import { recordEntry } from '@/server/services/stock';
import { getCurrencyFormat } from '@/server/currency';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.move');
  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, stockEntrySchema(currency.decimals));

  // L'audit est ecrit par le service, dans la meme transaction que le mouvement.
  const movement = await recordEntry(
    { companyId: context.companyId, userId: context.userId },
    input,
  );
  return jsonOk(movement, 201);
});
