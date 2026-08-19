import type { NextRequest } from 'next/server';
import { locationSchema } from '@/lib/validation/company';
import { createLocation, listLocations } from '@/server/services/locations';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('settings.locations');
  return jsonOk(await listLocations(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.locations');
  const input = await readJson(request, locationSchema);
  const location = await createLocation(context.companyId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'Location',
    entityId: location.id,
    summary: `Point de vente "${location.name}" cree`,
    ipAddress: clientIp(request),
  });

  return jsonOk(location, 201);
});
