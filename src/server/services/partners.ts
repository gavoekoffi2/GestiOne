import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { NotFoundError } from '@/server/errors';
import { nextDocumentNumber } from '@/server/sequences';
import type { PartnerInput, PartnerKind } from '@/lib/validation/catalog';

/**
 * Clients et fournisseurs.
 *
 * Les deux sont stockes dans la table `partners` et ne different que par `kind`.
 * Chaque fonction exige `companyId` **et** `kind` : il est donc impossible de
 * lire un fournisseur par une route "clients", ni les tiers d'une autre
 * entreprise.
 */

export interface PartnerListQuery {
  page: number;
  pageSize: number;
  search?: string;
  includeInactive?: boolean;
}

/**
 * Code sequentiel lisible : CLI-0001, FRN-0001.
 *
 * Le compteur passe par `DocumentSequence`, incremente par une unique
 * instruction SQL. Compter les tiers existants puis ajouter 1 ne fonctionne
 * pas : deux enregistrements simultanes lisent le meme total et tentent le
 * meme code. Le compteur n'est jamais recule, donc un code deja imprime sur un
 * document n'est jamais reattribue a un autre tiers.
 */
async function nextPartnerCode(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: PartnerKind,
): Promise<string> {
  return nextDocumentNumber(tx, companyId, kind, {
    prefix: kind === 'CUSTOMER' ? 'CLI' : 'FRN',
    period: 'NONE',
    padding: 4,
  });
}

export async function listPartners(
  companyId: string,
  kind: PartnerKind,
  query: PartnerListQuery,
) {
  const search = query.search?.trim();
  const where: Prisma.PartnerWhereInput = {
    companyId,
    kind,
    ...(query.includeInactive ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            // Le telephone est le principal moyen d'identifier un client :
            // la recherche doit y repondre autant que sur le nom.
            { phone: { contains: search } },
            { secondPhone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.partner.count({ where }),
    prisma.partner.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items,
  };
}

export async function getPartner(companyId: string, kind: PartnerKind, partnerId: string) {
  const partner = await prisma.partner.findFirst({ where: { id: partnerId, companyId, kind } });
  if (!partner) {
    throw new NotFoundError(kind === 'CUSTOMER' ? 'Client introuvable.' : 'Fournisseur introuvable.');
  }
  return partner;
}

function toData(input: PartnerInput) {
  return {
    name: input.name,
    companyName: input.companyName ?? null,
    phone: input.phone ?? null,
    secondPhone: input.secondPhone ?? null,
    email: input.email ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    countryCode: input.countryCode ?? null,
    taxNumber: input.taxNumber ?? null,
    creditLimit: input.creditLimit ?? 0n,
    notes: input.notes ?? null,
    isActive: input.isActive,
  };
}

export async function createPartner(companyId: string, kind: PartnerKind, input: PartnerInput) {
  return prisma.$transaction(async (tx) => {
    const code = await nextPartnerCode(tx, companyId, kind);
    return tx.partner.create({ data: { ...toData(input), companyId, kind, code } });
  });
}

export async function updatePartner(
  companyId: string,
  kind: PartnerKind,
  partnerId: string,
  input: PartnerInput,
) {
  await getPartner(companyId, kind, partnerId);
  return prisma.partner.update({ where: { id: partnerId }, data: toData(input) });
}

export async function deletePartner(companyId: string, kind: PartnerKind, partnerId: string) {
  await getPartner(companyId, kind, partnerId);

  // Un fournisseur reference par des articles ne peut pas disparaitre sans
  // detruire l'information d'approvisionnement : on le desactive.
  const referenced = await prisma.product.count({ where: { companyId, supplierId: partnerId } });
  if (referenced > 0) {
    return prisma.partner.update({ where: { id: partnerId }, data: { isActive: false } });
  }

  await prisma.partner.delete({ where: { id: partnerId } });
  return null;
}

/** Compteurs affiches en tete de liste. */
export async function countPartners(companyId: string, kind: PartnerKind) {
  const [total, active] = await Promise.all([
    prisma.partner.count({ where: { companyId, kind } }),
    prisma.partner.count({ where: { companyId, kind, isActive: true } }),
  ]);
  return { total, active, inactive: total - active };
}
