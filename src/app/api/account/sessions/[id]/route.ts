import type { NextRequest } from 'next/server';
import { revokeOwnSession } from '@/server/services/profile';
import { recordAudit } from '@/server/audit';
import { requireTenant } from '@/server/tenant';
import { clientIp, handler, jsonOk } from '@/server/http';

/**
 * Fermeture d'un appareil precis.
 *
 * Le service filtre sur `userId` : l'identifiant de session d'un autre
 * utilisateur rend 404, jamais une revocation.
 */
export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenant();
  const { id } = await params;

  await revokeOwnSession(context.userId, id as string, context.sessionId);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Session',
    entityId: id as string,
    summary: 'Appareil deconnecte a la demande de l\'utilisateur',
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
