import type { NextRequest } from 'next/server';
import { roleSchema } from '@/lib/validation/users';
import { createRole, listRoles } from '@/server/services/members';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('settings.roles');
  return jsonOk(await listRoles(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.roles');
  const input = await readJson(request, roleSchema);
  const role = await createRole(context.companyId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Role',
    entityId: role.id,
    summary: `Role "${role.name}" cree`,
    metadata: { permissions: role.permissions },
    ipAddress: clientIp(request),
  });

  return jsonOk(role, 201);
});
