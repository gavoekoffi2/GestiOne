import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { switchCompanySchema } from '@/lib/validation/auth';
import { SESSION_COOKIE_NAME, switchSessionMembership } from '@/server/auth/session';
import { getSessionUser } from '@/server/tenant';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { handler, jsonOk, readJson } from '@/server/http';

/** Bascule d'entreprise pour un utilisateur present dans plusieurs societes. */
export const POST = handler(async (request: NextRequest) => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionUser();
  if (!session || !token) throw new UnauthorizedError();

  const { membershipId } = await readJson(request, switchCompanySchema);

  // L'appartenance est verifiee cote serveur contre l'utilisateur de la
  // session : fournir l'identifiant d'une autre entreprise ne donne aucun acces.
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, userId: session.userId, isActive: true },
    select: { id: true, companyId: true },
  });
  if (!membership) throw new ForbiddenError("Vous n'avez pas acces a cette entreprise.");

  await switchSessionMembership(token, membership.id);
  return jsonOk({ companyId: membership.companyId });
});
