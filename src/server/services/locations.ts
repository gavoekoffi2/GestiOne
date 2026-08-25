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
    throw new ConflictError(`Le code "${input.code}" est déjà utilisé par un autre point de vente.`);
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
    throw new ConflictError(`Le code "${input.code}" est déjà utilisé par un autre point de vente.`);
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

export async function deleteLocation(companyId: string, locationId: string) {
  const location = await getLocation(companyId, locationId);

  const remaining = await prisma.location.count({ where: { companyId, isActive: true } });
  if (remaining <= 1) {
    throw new ValidationError(
      'Une entreprise doit conserver au moins un point de vente actif. Créez-en un autre avant de supprimer celui-ci.',
    );
  }

  // Le point de vente est reference par les appartenances (et, a partir de la
  // phase 3, par les mouvements de stock). Le supprimer effacerait un historique
  // comptable : on le desactive.
  const attached = await prisma.membership.count({ where: { defaultLocationId: locationId } });
  if (attached > 0 || location.isDefault) {
    return prisma.location.update({
      where: { id: locationId },
      data: { isActive: false, isDefault: false },
    });
  }

  return prisma.location.delete({ where: { id: locationId } });
}
