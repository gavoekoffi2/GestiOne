import type { NextRequest } from 'next/server';
import { createMemberSchema } from '@/lib/validation/users';
import { createMember, listMembers } from '@/server/services/members';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('settings.users');
  return jsonOk(await listMembers(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.users');
  const input = await readJson(request, createMemberSchema);
  const membership = await createMember(context.companyId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Membership',
    entityId: membership.id,
    summary: `${membership.user.fullName} ajoute a l'equipe avec le role ${membership.role.name}`,
    ipAddress: clientIp(request),
  });

  return jsonOk({ id: membership.id }, 201);
});
