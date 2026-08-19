import type { NextRequest } from 'next/server';
import { locationSchema } from '@/lib/validation/company';
import { deleteLocation, updateLocation } from '@/server/services/locations';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.locations');
  const { id } = await params;
  const input = await readJson(request, locationSchema);
  const location = await updateLocation(context.companyId, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Location',
    entityId: location.id,
    summary: `Point de vente "${location.name}" modifie`,
    ipAddress: clientIp(request),
  });

  return jsonOk(location);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.locations');
  const { id } = await params;
  const location = await deleteLocation(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'Location',
    entityId: id as string,
    summary: `Point de vente supprime ou desactive`,
    ipAddress: clientIp(request),
  });

  return jsonOk(location ?? { id });
});
