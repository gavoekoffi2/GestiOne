import { collectAlerts } from '@/server/services/notifications';
import { requireTenant } from '@/server/tenant';
import { handler, jsonOk } from '@/server/http';

/**
 * Alertes de l'utilisateur courant. Elles sont calculees a chaque appel : une
 * alerte resolue disparait d'elle-meme, sans tache de nettoyage.
 */
export const GET = handler(async () => {
  const context = await requireTenant();
  return jsonOk(await collectAlerts(context.companyId, context.permissions));
});
