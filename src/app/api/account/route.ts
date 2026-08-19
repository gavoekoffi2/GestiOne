import type { NextRequest } from 'next/server';
import { profileSchema } from '@/lib/validation/profile';
import { getProfile, updateProfile } from '@/server/services/profile';
import { recordAudit } from '@/server/audit';
import { requireTenant } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

/**
 * Compte personnel de l'utilisateur connecte.
 *
 * Aucune permission d'entreprise n'est exigee : agir sur son propre compte
 * n'est pas une operation d'administration. Un caissier sans le moindre droit
 * doit pouvoir corriger l'orthographe de son nom.
 */

export const GET = handler(async () => {
  const context = await requireTenant();
  return jsonOk(await getProfile(context.userId));
});

export const PUT = handler(async (request: NextRequest) => {
  const context = await requireTenant();
  const input = await readJson(request, profileSchema);
  const user = await updateProfile(context.userId, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'User',
    entityId: context.userId,
    summary: `Profil personnel mis a jour (${user.fullName})`,
    ipAddress: clientIp(request),
  });

  return jsonOk(user);
});
