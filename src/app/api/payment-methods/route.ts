import type { NextRequest } from 'next/server';
import { paymentMethodSchema } from '@/lib/validation/commerce';
import { createPaymentMethod, listPaymentMethods } from '@/server/services/commerce-setup';
import { recordAudit } from '@/server/audit';
import { requireTenant, requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

/**
 * La liste est accessible a quiconque peut encaisser : sans elle, l'ecran de
 * vente ne pourrait proposer aucun mode de reglement.
 */
export const GET = handler(async () => {
  const context = await requireTenant();
  return jsonOk(await listPaymentMethods(context.companyId));
});

export const POST = handler(async (request: NextRequest) => {
  const context = await requireTenantWith('settings.company');
  const method = await createPaymentMethod(
    context.companyId,
    await readJson(request, paymentMethodSchema),
  );

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: 'PaymentMethod',
    entityId: method.id,
    summary: `Mode de règlement "${method.name}" créé`,
    ipAddress: clientIp(request),
  });

  return jsonOk(method, 201);
});
