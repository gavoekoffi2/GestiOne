import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  IMPORT_TARGETS,
  isImportTarget,
  previewImport,
  runImport,
  templateFor,
} from '@/server/services/imports';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { NotFoundError, ValidationError } from '@/server/errors';
import { requireTenant, requirePermission } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';
import type { PermissionKey } from '@/server/permissions';

const bodySchema = z.object({
  content: z
    .string()
    .min(1, 'Le fichier est vide.')
    // Un fichier plus gros releve d'un traitement differe : l'accepter ici
    // bloquerait la requete plusieurs minutes sans retour a l'utilisateur.
    .max(5_000_000, 'Fichier trop volumineux (5 Mo maximum).'),
  confirm: z.coerce.boolean().default(false),
});

/** Modele de fichier a telecharger. */
export const GET = handler(async (_request: NextRequest, { params }) => {
  const { target } = await params;
  if (!isImportTarget(target as string)) throw new NotFoundError('Import inconnu.');

  const definition = IMPORT_TARGETS[target as keyof typeof IMPORT_TARGETS];
  const context = await requireTenant();
  requirePermission(context, definition.permission as PermissionKey);

  return new Response(templateFor(target as keyof typeof IMPORT_TARGETS), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="modèle-${target}.csv"`,
    },
  });
});

/**
 * `confirm: false` analyse et rend l'apercu ; `confirm: true` importe.
 * L'utilisateur voit toujours ce qui sera cree avant que la base ne bouge.
 */
export const POST = handler(async (request: NextRequest, { params }) => {
  const { target } = await params;
  if (!isImportTarget(target as string)) throw new NotFoundError('Import inconnu.');

  const key = target as keyof typeof IMPORT_TARGETS;
  const definition = IMPORT_TARGETS[key];
  const context = await requireTenant();
  requirePermission(context, definition.permission as PermissionKey);
  requirePermission(context, 'settings.import');

  const { content, confirm } = await readJson(request, bodySchema);
  const currency = await getCurrencyFormat(context.currencyCode);

  if (!confirm) {
    return jsonOk(await previewImport(context.companyId, key, content, currency));
  }

  const result = await runImport(context.companyId, key, content, currency);
  if (result.created === 0 && result.failed.length === 0) {
    throw new ValidationError(
      "Aucune ligne n'a pu être importée. Vérifiez l'aperçu avant de confirmer.",
    );
  }

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'IMPORT',
    entityType: definition.label,
    summary: `${result.created} ${definition.label.toLowerCase()} importe(s), ${result.skipped} ignore(s)`,
    metadata: { created: result.created, skipped: result.skipped, failed: result.failed.length },
    ipAddress: clientIp(request),
  });

  return jsonOk(result, 201);
});
