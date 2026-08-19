import type { NextRequest } from 'next/server';
import { stockTransferSchema } from '@/lib/validation/stock';
import { recordTransfer } from '@/server/services/stock';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.move');
  const input = await readJson(request, stockTransferSchema);
  const result = await recordTransfer(
    { companyId: context.companyId, userId: context.userId },
    input,
  );
  return jsonOk(result, 201);
});
