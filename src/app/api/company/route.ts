import type { NextRequest } from 'next/server';
import { updateCompanySchema } from '@/lib/validation/company';
import { getCompanyProfile, updateCompany } from '@/server/services/companies';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const GET = handler(async () => {
  const context = await requireTenantWith('settings.company');
  return jsonOk(await getCompanyProfile(context.companyId));
});

export const PUT = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.company');
  const input = await readJson(request, updateCompanySchema);

  const company = await updateCompany(context.companyId, {
    ...input,
    legalName: input.legalName ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    taxNumber: input.taxNumber ?? null,
    documentFooter: input.documentFooter ?? null,
    paymentTerms: input.paymentTerms ?? null,
  });

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'Company',
    entityId: context.companyId,
    summary: `Parametres de l'entreprise modifies`,
    ipAddress: clientIp(request),
  });

  return jsonOk(company);
});
