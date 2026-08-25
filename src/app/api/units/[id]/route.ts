import type { NextRequest } from 'next/server';
import { unitSchema } from '@/lib/validation/catalog';
import { deleteUnit, updateUnit } from '@/server/services/catalog';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.write');
  const { id } = await params;
  const unit = await updateUnit(context.companyId, id as string, await readJson(request, unitSchema));

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Unit',
    entityId: unit.id,
    summary: `Unité "${unit.name}" modifiée`,
    ipAddress: clientIp(request),
  });

  return jsonOk(unit);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('products.delete');
  const { id } = await params;
  await deleteUnit(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'Unit',
    entityId: id as string,
    summary: 'Unité supprimée',
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
