import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { revokeSession, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { getSessionUser } from '@/server/tenant';
import { recordAudit } from '@/server/audit';
import { clientIp, handler, jsonOk } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionUser();

  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE_NAME);

  if (session) {
    await recordAudit({
      userId: session.userId,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: session.userId,
      summary: `Déconnexion de ${session.email}`,
      ipAddress: clientIp(request),
    });
  }

  return jsonOk({ ok: true });
});
