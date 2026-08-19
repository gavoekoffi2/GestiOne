import type { NextRequest } from 'next/server';
import { stockInventorySchema } from '@/lib/validation/stock';
import { recordInventory } from '@/server/services/stock';
import { requireTenantWith } from '@/server/tenant';
import { handler, jsonOk, readJson } from '@/server/http';

/**
 * L'inventaire corrige un solde : il exige `stock.adjust`, une permission plus
 * restreinte que `stock.move`, car il peut masquer un ecart plutot que le
 * constater.
 */
export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('stock.adjust');
  const input = await readJson(request, stockInventorySchema);
  const movement = await recordInventory(
    { companyId: context.companyId, userId: context.userId },
    input,
  );
  return jsonOk(movement, 201);
});
