import type { NextRequest } from 'next/server';
import { resetMemberPasswordSchema } from '@/lib/validation/profile';
import { resetMemberPassword } from '@/server/services/members';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

/**
 * Reinitialisation du mot de passe d'un collaborateur.
 *
 * Le nouveau mot de passe n'est jamais renvoye par la reponse : l'appelant le
 * connait deja, puisqu'il vient de le choisir. Le journal d'audit conserve la
 * trace de l'operation, jamais le mot de passe lui-meme.
 */
export const POST = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.users');
  const { id } = await params;
  const input = await readJson(request, resetMemberPasswordSchema);

  const result = await resetMemberPassword(context.companyId, id as string, input.password);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'PERMISSION_CHANGE',
    entityType: 'User',
    entityId: result.userId,
    summary: `Mot de passe de ${result.fullName} reinitialise ; ${result.revokedSessions} session(s) fermee(s)`,
    ipAddress: clientIp(request),
  });

  return jsonOk({ revokedSessions: result.revokedSessions });
});
