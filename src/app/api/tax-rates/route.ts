import type { NextRequest } from 'next/server';
import { taxRateSchema } from '@/lib/validation/commerce';
import { createTaxRate, listTaxRates } from '@/server/services/commerce-setup';
import { recordAudit } from '@/server/audit';
import { requireTenant, requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenant();
  return jsonOk(await listTaxRates(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.company');
  const taxRate = await createTaxRate(context.companyId, await readJson(request, taxRateSchema));

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'TaxRate',
    entityId: taxRate.id,
    summary: `Taux de taxe "${taxRate.name}" créé`,
    ipAddress: clientIp(request),
  });

  return jsonOk(taxRate, 201);
});
