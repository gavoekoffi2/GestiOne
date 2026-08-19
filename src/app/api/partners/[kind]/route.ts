import type { NextRequest } from 'next/server';
import { partnerSchema, type PartnerKind } from '@/lib/validation/catalog';
import { listQuerySchema } from '@/lib/validation/list-query';
import { createPartner, listPartners } from '@/server/services/partners';
import { getCurrencyFormat } from '@/server/currency';
import { recordAudit } from '@/server/audit';
import { NotFoundError } from '@/server/errors';
import { requireTenantWith } from '@/server/tenant';
import { clientIp, handler, jsonOk, readJson, readQuery } from '@/server/http';
import type { PermissionKey } from '@/server/permissions';

/**
 * Clients et fournisseurs partagent ces routes. Le segment `kind` de l'URL
 * ("clients" ou "fournisseurs") selectionne le type **et** la permission a
 * exiger : il n'existe donc pas de chemin permettant de lire les fournisseurs
 * avec un droit qui ne couvre que les clients.
 */
export function resolveKind(segment: string): {
  kind: PartnerKind;
  read: PermissionKey;
  write: PermissionKey;
  remove: PermissionKey;
} {
  if (segment === 'clients') {
    return {
      kind: 'CUSTOMER',
      read: 'customers.read',
      write: 'customers.write',
      remove: 'customers.delete',
    };
  }
  if (segment === 'fournisseurs') {
    return {
      kind: 'SUPPLIER',
      read: 'suppliers.read',
      write: 'suppliers.write',
      remove: 'suppliers.delete',
    };
  }
  throw new NotFoundError('Type de tiers inconnu.');
}

export const GET = handler(async (request: NextRequest, { params }) => {
  const { kind: segment } = await params;
  const target = resolveKind(segment as string);
  const context = await requireTenantWith(target.read);
  const query = readQuery(request, listQuerySchema);

  return jsonOk(await listPartners(context.companyId, target.kind, query));
});

export const POST = handler(async (request: NextRequest, { params }) => {
  const { kind: segment } = await params;
  const target = resolveKind(segment as string);
  const context = await requireTenantWith(target.write);

  const currency = await getCurrencyFormat(context.currencyCode);
  const input = await readJson(request, partnerSchema(currency.decimals));
  const partner = await createPartner(context.companyId, target.kind, input);

  await recordAudit({
    companyId: context.companyId,
    userId: context.userId,
    action: 'CREATE',
    entityType: target.kind === 'CUSTOMER' ? 'Customer' : 'Supplier',
    entityId: partner.id,
    summary: `${target.kind === 'CUSTOMER' ? 'Client' : 'Fournisseur'} "${partner.name}" cree (${partner.code})`,
    ipAddress: clientIp(request),
  });

  return jsonOk(partner, 201);
});
