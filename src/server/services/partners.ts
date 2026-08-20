import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { NotFoundError, ValidationError } from '@/server/errors';
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

/**
 * Tiers designe par son nom, saisi en pleine vente.
 *
 * Derriere un comptoir, exiger que la fiche du client existe **avant** la vente
 * revient a la faire abandonner : le vendeur choisit « client de passage », et
 * la creance devient introuvable. On accepte donc un simple nom.
 *
 * Le nom est d'abord compare aux fiches existantes, sans tenir compte de la
 * casse ni des accents : « koffi yao » retrouve « Koffi Yao ». C'est ce qui
 * evite qu'une meme personne existe en trois exemplaires au bout d'un mois.
 * Sans correspondance, la fiche est creee avec ce seul nom — le telephone et
 * l'adresse se completeront plus tard, si un jour ils servent.
 */
export async function findOrCreatePartnerByName(
  companyId: string,
  kind: PartnerKind,
  rawName: string,
): Promise<string> {
  const name = rawName.trim();
  if (!name) throw new ValidationError('Indiquez un nom.');

  const existing = await prisma.partner.findFirst({
    where: { companyId, kind, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
    // A doublons deja presents, on rattache au plus ancien : c'est celui qui
    // porte l'historique.
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing.id;

  const created = await createPartner(companyId, kind, {
    name,
    isActive: true,
    creditLimit: undefined,
    companyName: undefined,
    phone: undefined,
    secondPhone: undefined,
    email: undefined,
    addressLine: undefined,
    city: undefined,
    countryCode: undefined,
    taxNumber: undefined,
    notes: undefined,
  });

  return created.id;
}

/**
 * Resout la designation d'un tiers portee par un document : un identifiant de
 * fiche, un nom libre, ou rien du tout (vente au client de passage).
 *
 * La fiche est creee au moment de la resolution, donc avant l'enregistrement du
 * document. Si celui-ci echoue ensuite — stock insuffisant, plafond d'encours —
 * la fiche demeure. C'est assume : le vendeur vient d'en saisir le nom, et la
 * prochaine tentative la retrouvera au lieu d'en creer une seconde.
 */
export async function resolvePartnerReference(
  companyId: string,
  kind: PartnerKind,
  reference: { id?: string; name?: string },
): Promise<string | undefined> {
  if (reference.id) return reference.id;
  const name = reference.name?.trim();
  if (!name) return undefined;
  return findOrCreatePartnerByName(companyId, kind, name);
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
