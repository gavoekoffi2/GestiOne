import type { NextRequest } from 'next/server';
import { taxRateSchema } from '@/lib/validation/commerce';
import { deleteTaxRate, updateTaxRate } from '@/server/services/commerce-setup';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.company');
  const { id } = await params;
  const taxRate = await updateTaxRate(
    context.companyId,
    id as string,
    await readJson(request, taxRateSchema),
  );

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'TaxRate',
    entityId: taxRate.id,
    summary: `Taux de taxe "${taxRate.name}" modifié`,
    ipAddress: clientIp(request),
  });

  return jsonOk(taxRate);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.company');
  const { id } = await params;
  await deleteTaxRate(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'TaxRate',
    entityId: id as string,
    summary: 'Taux de taxe supprimé',
    ipAddress: clientIp(request),
  });

  return jsonOk({ id });
});
