import type { NextRequest } from 'next/server';
import { paymentMethodSchema } from '@/lib/validation/commerce';
import { deletePaymentMethod, updatePaymentMethod } from '@/server/services/commerce-setup';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';

export const PUT = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.company');
  const { id } = await params;
  const method = await updatePaymentMethod(
    context.companyId,
    id as string,
    await readJson(request, paymentMethodSchema),
  );

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: 'PaymentMethod',
    entityId: method.id,
    summary: `Mode de reglement "${method.name}" modifie`,
    ipAddress: clientIp(request),
  });

  return jsonOk(method);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const context = await requireTenantWith('settings.company');
  const { id } = await params;
  const result = await deletePaymentMethod(context.companyId, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: 'PaymentMethod',
    entityId: id as string,
    summary: result ? 'Mode de reglement desactive (deja utilise)' : 'Mode de reglement supprime',
    ipAddress: clientIp(request),
  });

  return jsonOk(result ?? { id });
});
