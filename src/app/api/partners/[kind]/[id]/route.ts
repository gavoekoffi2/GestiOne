import type { NextRequest } from 'next/server';
import { partnerSchema } from '@/lib/validation/catalog';
import { deletePartner, getPartner, updatePartner } from '@/server/services/partners';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson } from '@/server/http';
import { resolveKind } from '../route';

export const GET = handler(async (_request: NextRequest, { params }) => {
  const { kind: segment, id } = await params;
  const target = resolveKind(segment as string);
  const context = await requireTenantWith(target.read);
  return jsonOk(await getPartner(context.companyId, target.kind, id as string));
});

export const PUT = handler(async (request: NextRequest, { params }) => {
  const { kind: segment, id } = await params;
  const target = resolveKind(segment as string);
  const context = await requireTenantWith(target.write);

  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, partnerSchema(currency.decimals));
  const partner = await updatePartner(context.companyId, target.kind, id as string, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'UPDATE',
    entityType: target.kind === 'CUSTOMER' ? 'Customer' : 'Supplier',
    entityId: partner.id,
    summary: `"${partner.name}" modifie (${partner.code})`,
    ipAddress: clientIp(request),
  });

  return jsonOk(partner);
});

export const DELETE = handler(async (request: NextRequest, { params }) => {
  const { kind: segment, id } = await params;
  const target = resolveKind(segment as string);
  const context = await requireTenantWith(target.remove);

  const result = await deletePartner(context.companyId, target.kind, id as string);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'DELETE',
    entityType: target.kind === 'CUSTOMER' ? 'Customer' : 'Supplier',
    entityId: id as string,
    summary: result ? 'Tiers desactive (references existantes)' : 'Tiers supprime',
    ipAddress: clientIp(request),
  });

  return jsonOk(result ?? { id });
});
