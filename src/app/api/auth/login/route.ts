import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { loginSchema } from '@/lib/validation/auth';
import { authenticate, touchLastLogin } from '@/server/services/accounts';
import { createSession, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { recordAudit } from '@/server/audit';
import { checkRateLimit } from '@/server/rate-limit';
import { RateLimitError } from '@/server/errors';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await readJson(request, loginSchema);

  // Double limite : par adresse IP (attaque distribuee depuis une machine) et
  // par compte (bourrage d'identifiants cible sur un utilisateur connu).
  for (const key of [`login:ip:${ip}`, `login:user:${input.email}`]) {
    const limit = checkRateLimit(key, 10, 300);
    if (!limit.allowed) throw new RateLimitError(undefined, limit.retryAfterSeconds);
  }

  try {
    const user = await authenticate(input.email, input.password);

    const session = await createSession({
      userId: user.userId,
      membershipId: user.membershipId,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
    });

    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

    await touchLastLogin(user.userId);
    await recordAudit({
      userId: user.userId,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.userId,
      summary: `Connexion de ${user.email}`,
      ipAddress: ip,
    });

    return jsonOk({ userId: user.userId });
  } catch (error) {
    await recordAudit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      summary: `Echec de connexion pour ${input.email}`,
      ipAddress: ip,
    });
    throw error;
  }
});
