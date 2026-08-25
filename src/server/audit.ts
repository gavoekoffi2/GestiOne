import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Journal d'audit append-only. Aucune fonction de modification ou de
 * suppression n'est exposee : un evenement enregistre ne peut plus changer.
 */

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'PAYMENT'
  | 'STOCK_MOVE'
  | 'CANCEL'
  | 'PERMISSION_CHANGE'
  | 'IMPORT'
  | 'EXPORT';

export interface AuditInput {
  companyId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Ecrit un evenement d'audit. Volontairement tolerant aux pannes : un echec de
 * journalisation ne doit jamais faire echouer l'operation metier deja validee,
 * mais il est signale dans les logs serveur.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: input.companyId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] impossible d\'enregistrer l\'événement', input.action, error);
  }
}

/**
 * Variante transactionnelle : l'evenement fait partie de la meme transaction
 * que l'operation metier. A utiliser quand la trace est indissociable de
 * l'action (paiement, mouvement de stock, annulation).
 */
export async function recordAuditTx(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: input.companyId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
