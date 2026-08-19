import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { registerSchema } from '@/lib/validation/auth';
import { registerAccount } from '@/server/services/accounts';
import { ensureCurrencies } from '@/server/services/currencies';
import { createSession, sessionCookieOptions, SESSION_COOKIE_NAME } from '@/server/auth/session';
import { recordAudit } from '@/server/audit';
import { checkRateLimit } from '@/server/rate-limit';
import { RateLimitError } from '@/server/errors';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const POST = handler(async (request: NextRequest) => {
  const ip = clientIp(request);
  // Une inscription cree une entreprise : la limite est basse pour eviter
  // qu'un script ne remplisse la base.
  const limit = checkRateLimit(`register:${ip}`, 5, 3600);
  if (!limit.allowed) throw new RateLimitError(undefined, limit.retryAfterSeconds);

  const input = await readJson(request, registerSchema);
  await ensureCurrencies();

  const result = await registerAccount(input);

  const session = await createSession({
    userId: result.userId,
    membershipId: result.membershipId,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

  await recordAudit({
    companyId: result.companyId,
    userId: result.userId,
    action: 'CREATE',
    entityType: 'Company',
    entityId: result.companyId,
    summary: `Creation de l'entreprise "${input.companyName}"`,
    ipAddress: ip,
  });

  return jsonOk({ companyId: result.companyId }, 201);
});
