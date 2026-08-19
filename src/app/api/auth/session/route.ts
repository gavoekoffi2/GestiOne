import { getSessionUser, getTenantContext } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

/** Etat d'authentification courant, consomme par le menu de l'application. */
export const GET = handler(async () => {
  const session = await getSessionUser();
  if (!session) return jsonOk({ authenticated: false });

  const context = await getTenantContext();
  return jsonOk({
    authenticated: true,
    user: { id: session.userId, email: session.email, fullName: session.fullName },
    memberships: session.memberships,
    activeCompany: context
      ? {
          id: context.companyId,
          name: context.companyName,
          currencyCode: context.currencyCode,
          roleName: context.roleName,
          permissions: context.permissions,
        }
      : null,
  });
});
