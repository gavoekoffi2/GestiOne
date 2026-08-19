import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { loginSchema } from '@/lib/validation/auth';
import { authenticate, touchLastLogin } from '@/server/services/accounts';
import { createSession, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { recordAudit } from '@/server/audit';
import { clearRateLimit, peekRateLimit, recordAttempt } from '@/server/rate-limit';
import { RateLimitError } from '@/server/errors';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

/**
 * Fenetres de limitation.
 *
 * La limite par adresse IP est large : dans une boutique, toute l'equipe passe
 * par la meme connexion, et seuls les **echecs** sont comptabilises. La limite
 * par compte est stricte, car c'est elle qui arrete reellement un bourrage
 * d'identifiants vise sur un utilisateur connu.
 */
const IP_LIMIT = { attempts: 30, windowSeconds: 300 };
const ACCOUNT_LIMIT = { attempts: 8, windowSeconds: 900 };

export const POST = handler(async (request: NextRequest) => {
  const ip = clientIp(request);
  const input = await readJson(request, loginSchema);

  const ipKey = `login:ip:${ip}`;
  const accountKey = `login:user:${input.email}`;

  for (const [key, limit] of [
    [ipKey, IP_LIMIT],
    [accountKey, ACCOUNT_LIMIT],
  ] as const) {
    const state = peekRateLimit(key, limit.attempts, limit.windowSeconds);
    if (!state.allowed) throw new RateLimitError(undefined, state.retryAfterSeconds);
  }

  try {
    const user = await authenticate(input.email, input.password);

    // Le titulaire legitime s'est authentifie : les echecs precedents sur ce
    // compte ne doivent plus peser sur ses prochaines connexions.
    clearRateLimit(accountKey);

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
    recordAttempt(ipKey, IP_LIMIT.windowSeconds);
    recordAttempt(accountKey, ACCOUNT_LIMIT.windowSeconds);

    await recordAudit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      summary: `Echec de connexion pour ${input.email}`,
      ipAddress: ip,
    });
    throw error;
  }
});
