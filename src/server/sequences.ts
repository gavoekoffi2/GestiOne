import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Numerotation des documents (FAC-2026-00001).
 *
 * Le compteur vit en base et est incremente **dans la transaction qui cree le
 * document**. Deux ventes simultanees ne peuvent donc pas obtenir le meme
 * numero : la seconde attend le verrou de la ligne de sequence.
 */

export type DocumentType = 'INVOICE' | 'QUOTE' | 'SALE' | 'PURCHASE' | 'PAYMENT' | 'RECEIPT';

export interface SequenceOptions {
  prefix: string;
  /** "YEAR" ajoute l'annee au numero, "NONE" produit un compteur continu. */
  period?: 'YEAR' | 'MONTH' | 'NONE';
  padding?: number;
  now?: Date;
}

export function periodKey(period: 'YEAR' | 'MONTH' | 'NONE', now: Date): string {
  if (period === 'NONE') return 'ALL';
  const year = now.getUTCFullYear();
  if (period === 'YEAR') return String(year);
  return `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatDocumentNumber(
  prefix: string,
  period: string,
  value: number,
  padding: number,
): string {
  const body = String(value).padStart(padding, '0');
  return period === 'ALL' ? `${prefix}-${body}` : `${prefix}-${period}-${body}`;
}

/**
 * Reserve le prochain numero. Doit etre appele avec le client transactionnel
 * de l'operation, sinon la garantie d'unicite disparait.
 *
 * L'increment tient en **une seule instruction SQL** : `INSERT ... ON CONFLICT
 * DO UPDATE`. Un `upsert` Prisma (SELECT, puis INSERT ou UPDATE) ne suffit pas :
 * deux transactions simultanees constatent toutes les deux l'absence de ligne
 * et tentent l'insertion, ce qui fait echouer la seconde sur la contrainte
 * unique. Ici, la seconde transaction bascule sur la branche UPDATE et attend
 * le verrou de ligne : deux caissiers qui encaissent au meme instant obtiennent
 * donc bien deux numeros de facture distincts.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  documentType: DocumentType,
  options: SequenceOptions,
): Promise<string> {
  const period = periodKey(options.period ?? 'YEAR', options.now ?? new Date());
  const padding = options.padding ?? 5;
  const id = randomUUID();

  const rows = await tx.$queryRaw<Array<{ assigned: number; prefix: string; padding: number }>>`
    INSERT INTO "document_sequences"
      ("id", "companyId", "documentType", "period", "prefix", "nextValue", "padding", "updatedAt")
    VALUES (${id}, ${companyId}, ${documentType}, ${period}, ${options.prefix}, 2, ${padding}, NOW())
    ON CONFLICT ("companyId", "documentType", "period") DO UPDATE
      SET "nextValue" = "document_sequences"."nextValue" + 1,
          "prefix"    = EXCLUDED."prefix",
          "padding"   = EXCLUDED."padding",
          "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS "assigned", "prefix", "padding"
  `;

  const row = rows[0];
  if (!row) throw new Error('Impossible de reserver un numero de document.');

  return formatDocumentNumber(row.prefix, period, row.assigned, row.padding);
}
