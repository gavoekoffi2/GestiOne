import { prisma } from '@/server/db';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import type { LocationInput } from '@/lib/validation/company';

/**
 * Points de vente (boutiques, depots, agences).
 *
 * Toutes les fonctions prennent `companyId` en premier argument : il n'existe
 * aucun chemin permettant de lire ou modifier le point de vente d'une autre
 * entreprise, meme en fournissant un identifiant valide.
 */

export async function listLocations(companyId: string) {
  return prisma.location.findMany({
    where: { companyId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function getLocation(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId } });
  if (!location) throw new NotFoundError('Point de vente introuvable.');
  return location;
}

export async function createLocation(companyId: string, input: LocationInput) {
  const duplicate = await prisma.location.findFirst({
    where: { companyId, code: input.code },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictError(`Le code "${input.code}" est deja utilise par un autre point de vente.`);
  }

  return prisma.$transaction(async (tx) => {
    // Un seul point de vente peut porter le drapeau "par defaut" : le nouveau
    // le prend, les autres le perdent, dans la meme transaction.
    if (input.isDefault) {
      await tx.location.updateMany({ where: { companyId }, data: { isDefault: false } });
    }
    return tx.location.create({ data: { ...input, companyId } });
  });
}

export async function updateLocation(companyId: string, locationId: string, input: LocationInput) {
  await getLocation(companyId, locationId);

  const duplicate = await prisma.location.findFirst({
    where: { companyId, code: input.code, id: { not: locationId } },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictError(`Le code "${input.code}" est deja utilise par un autre point de vente.`);
  }

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.location.updateMany({
        where: { companyId, id: { not: locationId } },
        data: { isDefault: false },
      });
    }
    return tx.location.update({ where: { id: locationId }, data: input });
  });
}

/** Vrai si le point de vente apparait dans un document ou un journal. */
async function locationHasHistory(companyId: string, locationId: string): Promise<boolean> {
  const where = { companyId, locationId };
  const counts = await Promise.all([
    prisma.membership.count({ where: { companyId, defaultLocationId: locationId } }),
    prisma.stockLevel.count({ where }),
    prisma.stockMovement.count({ where }),
    prisma.cashSession.count({ where }),
    prisma.cashMovement.count({ where }),
    prisma.invoice.count({ where }),
    prisma.quote.count({ where }),
    prisma.payment.count({ where }),
    prisma.purchaseOrder.count({ where }),
    prisma.expense.count({ where }),
  ]);
  return counts.some((count) => count > 0);
}

export async function deleteLocation(companyId: string, locationId: string) {
  const location = await getLocation(companyId, locationId);

  const remaining = await prisma.location.count({ where: { companyId, isActive: true } });
  if (remaining <= 1) {
    throw new ValidationError(
      'Une entreprise doit conserver au moins un point de vente actif. Creez-en un autre avant de supprimer celui-ci.',
    );
  }

  // Le point de vente porte tout un historique. La base supprime EN CASCADE ses
  // soldes et mouvements de stock, ses sessions et mouvements de caisse : un
  // DELETE effacerait donc la preuve de chaque entree, sortie et encaissement.
  // Des qu'il a servi, on le desactive ; seul un point de vente jamais utilise
  // est reellement supprime.
  if (location.isDefault || (await locationHasHistory(companyId, locationId))) {
    return prisma.location.update({
      where: { id: locationId },
      data: { isActive: false, isDefault: false },
    });
  }

  return prisma.location.delete({ where: { id: locationId } });
}
