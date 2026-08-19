import type { NextRequest } from 'next/server';
import { stockExitSchema } from '@/lib/validation/stock';
import { recordExit } from '@/server/services/stock';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.move');
  const input = await readJson(request, stockExitSchema);
  const movement = await recordExit(
    { companyId: context.companyId, userId: context.userId },
    input,
  );
  return jsonOk(movement, 201);
});
