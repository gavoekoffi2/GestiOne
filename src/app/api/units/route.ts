import type { NextRequest } from 'next/server';
import { unitSchema } from '@/lib/validation/catalog';
import { createUnit, listUnits } from '@/server/services/catalog';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('products.read');
  return jsonOk(await listUnits(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('products.write');
  const input = await readJson(request, unitSchema);
  const unit = await createUnit(context.companyId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'Unit',
    entityId: unit.id,
    summary: `Unité "${unit.name}" (${unit.symbol}) creee`,
    ipAddress: clientIp(request),
  });

  return jsonOk(unit, 201);
});
