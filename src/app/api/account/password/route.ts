import type { NextRequest } from 'next/server';
import { changePasswordSchema } from '@/lib/validation/profile';
import { changeOwnPassword } from '@/server/services/profile';
import { recordAudit } from '@/server/audit';
import { requireTenant } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';
import { peekRateLimit, recordAttempt } from '@/server/rate-limit';
import { RateLimitError } from '@/server/errors';

/**
 * Changement du mot de passe par l'utilisateur lui-meme.
 *
 * Le mot de passe actuel est exige : sans cela, un poste laisse ouvert une
 * minute suffirait a verrouiller definitivement le compte de son proprietaire.
 *
 * La limitation de debit porte sur le compte et non sur l'adresse IP, et ne
 * compte que les echecs. Ce formulaire est un oracle : il repond « mot de passe
 * actuel incorrect », donc il permettrait de tester des mots de passe sur une
 * session volee. Une boutique entiere partageant une seule adresse IP publique
 * ne doit pas pour autant se bloquer mutuellement.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 10;

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenant();
  const key = `password-change:${context.userId}`;

  const limit = peekRateLimit(key, MAX_FAILURES, WINDOW_SECONDS);
  if (!limit.allowed) {
    throw new RateLimitError(
      'Trop de tentatives infructueuses. Reessayez dans quelques minutes.',
      limit.retryAfterSeconds,
    );
  }

  const input = await readJson(request, changePasswordSchema);

  let result: { revokedSessions: number };
  try {
    result = await changeOwnPassword(
      context.userId,
      context.sessionId,
      input.currentPassword,
      input.newPassword,
    );
  } catch (error) {
    recordAttempt(key, WINDOW_SECONDS);
    throw error;
  }

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'User',
    entityId: context.userId,
    summary:
      result.revokedSessions > 0
        ? `Mot de passe change ; ${result.revokedSessions} autre(s) appareil(s) deconnecte(s)`
        : 'Mot de passe change',
    ipAddress: clientIp(request),
  });

  return jsonOk(result);
});
