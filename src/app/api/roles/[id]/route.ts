import type { NextRequest } from 'next/server';
import { roleSchema } from '@/lib/validation/users';
import { deleteRole, updateRole } from '@/server/services/members';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.roles');
  const { id } = await params;
  const input = await readJson(request, roleSchema);
  const role = await updateRole(context.companyId, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Role',
    entityId: role.id,
    summary: `Permissions du role "${role.name}" modifiees`,
    metadata: { permissions: role.permissions },
    ipAddress: clientIp(request),
  });

  return jsonOk(role);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.roles');
  const { id } = await params;
  await deleteRole(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Role',
    entityId: id as string,
    summary: 'Role supprime',
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
