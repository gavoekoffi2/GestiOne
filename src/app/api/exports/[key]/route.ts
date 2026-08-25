import type { NextRequest } from 'next/server';
import { EXPORTS, isExportKey, runExport } from '@/server/services/exports';
import { resolvePeriod, type PeriodKey } from '@/server/services/reports';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { NotFoundError } from '@/server/errors';
import { can, requireTenant, requirePermission } from '@/server/tenant';
import { clientIp, handler } from '@/server/http';
import type { PermissionKey } from '@/server/permissions';

const PERIODS: PeriodKey[] = ['today', 'week', 'month', 'quarter', 'year', 'custom'];

/**
 * Telechargement d'un export CSV.
 *
 * Chaque export exige la permission du module qu'il expose : `settings.import`
 * ne suffit pas a exporter les creances si l'utilisateur n'a pas acces aux
 * factures. Un export est une lecture de masse — il doit obeir aux memes regles
 * que la consultation.
 */
export const GET = handler(async (request: NextRequest, { params }) => {
  const { key } = await params;
  if (!isExportKey(key as string)) throw new NotFoundError('Export inconnu.');

  const definition = EXPORTS[key as keyof typeof EXPORTS];
  const context = await requireTenant();
  requirePermission(context, definition.permission as PermissionKey);
  requirePermission(context, 'reports.export');

  const currency = await getCurrencyFormat(context.currencyCode);
  const url = request.nextUrl;

  const periodKey = (url.searchParams.get('period') ?? 'month') as PeriodKey;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const period = resolvePeriod(
    PERIODS.includes(periodKey) ? periodKey : 'month',
    new Date(),
    from && to ? { from: new Date(from), to: new Date(to) } : undefined,
  );

  const csv = await runExport(
    key as keyof typeof EXPORTS,
    {
      companyId: context.companyId,
      currency,
      locale: context.locale,
      canSeeCost: can(context, 'products.cost.read'),
    },
    period,
    url.searchParams.get('locationId') || undefined,
  );

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'EXPORT',
    entityType: 'Export',
    entityId: key as string,
    summary: `Export "${definition.label}" telecharge`,
    ipAddress: clientIp(request),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `gestione-${key}-${stamp}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // `attachment` force le telechargement plutot que l'affichage : un CSV
      // rendu dans l'onglet serait inexploitable.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
