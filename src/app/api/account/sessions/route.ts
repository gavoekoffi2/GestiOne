import type { NextRequest } from 'next/server';
import { listActiveSessions, revokeOtherSessions } from '@/server/services/profile';
import { recordAudit } from '@/server/audit';
import { requireTenant } from '@/server/tenant';
import { clientIp, handler, jsonOk } from '@/server/http';

/** Appareils connectes au compte, et fermeture de tous les autres. */

export const GET = handler(async () => {
  const context = await requireTenant();
  return jsonOk(await listActiveSessions(context.userId, context.sessionId));
});

export const DELETE = handler(async (request: NextRequest) => {
  const context = await requireTenant();
  const count = await revokeOtherSessions(context.userId, context.sessionId);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Session',
    entityId: context.userId,
    summary: `${count} appareil(s) deconnecte(s) a la demande de l'utilisateur`,
    ipAddress: clientIp(request),
  });

  return jsonOk({ revokedSessions: count });
});
