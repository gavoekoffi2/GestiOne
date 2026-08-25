import type { NextRequest } from 'next/server';
import { updateMemberSchema } from '@/lib/validation/users';
import { removeMember, updateMember } from '@/server/services/members';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.users');
  const { id } = await params;
  const input = await readJson(request, updateMemberSchema);
  const membership = await updateMember(context.companyId, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Membership',
    entityId: membership.id,
    summary: `${membership.user.fullName} : rôle ${membership.role.name}, compte ${
      membership.isActive ? 'actif' : 'desactive'
    }`,
    ipAddress: clientIp(request),
  });

  return jsonOk({ id: membership.id });
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.users');
  const { id } = await params;
  await removeMember(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'Membership',
    entityId: id as string,
    summary: "Utilisateur retiré de l'équipe",
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
