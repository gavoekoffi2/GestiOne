import { prisma } from '@/server/db';

/**
 * Consultation du journal d'audit. Lecture seule : aucune fonction de ce module
 * ne modifie ni ne supprime un evenement.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Connexion',
  LOGIN_FAILED: 'Echec de connexion',
  LOGOUT: 'Deconnexion',
  CREATE: 'Creation',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
  PAYMENT: 'Paiement',
  STOCK_MOVE: 'Mouvement de stock',
  CANCEL: 'Annulation',
  PERMISSION_CHANGE: 'Changement de droits',
  IMPORT: 'Import',
  EXPORT: 'Export',
};

export interface AuditQuery {
  page: number;
  pageSize: number;
  action?: string;
  search?: string;
}

export async function listAuditLogs(companyId: string, query: AuditQuery) {
  const where = {
    companyId,
    ...(query.action ? { action: query.action } : {}),
    ...(query.search
      ? {
          OR: [
            { summary: { contains: query.search, mode: 'insensitive' as const } },
            { entityType: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    entries,
  };
}
