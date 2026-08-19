import { prisma } from '@/server/db';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError } from '@/server/errors';
import { SYSTEM_ROLES } from '@/server/permissions';
import { slugify } from '@/lib/validation/common';
import { provisionDefaultUnits } from '@/server/services/catalog';
import { provisionPaymentMethods } from '@/server/services/commerce-setup';
import { provisionExpenseCategories } from '@/server/services/expenses';

/**
 * Provisionnement d'une entreprise.
 *
 * Une entreprise n'est jamais utilisable "a moitie" : la creation installe dans
 * la meme transaction ses roles, son point de vente principal et l'appartenance
 * de son proprietaire. Si l'une de ces etapes echoue, rien n'est ecrit.
 */

/** Trouve un slug libre en suffixant un compteur ("boutique-kofi", "-2", "-3"...). */
export async function findAvailableSlug(
  tx: Prisma.TransactionClient,
  desired: string,
): Promise<string> {
  const base = slugify(desired) || 'entreprise';
  let candidate = base;
  let suffix = 1;

  // La contrainte unique en base reste l'autorite : cette boucle evite
  // simplement de renvoyer une erreur a l'utilisateur dans le cas courant.
  while (await tx.company.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 200) throw new ConflictError('Impossible de generer un identifiant unique.');
  }
  return candidate;
}

export interface ProvisionCompanyInput {
  name: string;
  countryCode: string;
  currencyCode: string;
  ownerUserId: string;
  locale?: string;
}

export interface ProvisionedCompany {
  companyId: string;
  membershipId: string;
  locationId: string;
  adminRoleId: string;
}

export async function provisionCompany(
  tx: Prisma.TransactionClient,
  input: ProvisionCompanyInput,
): Promise<ProvisionedCompany> {
  const currency = await tx.currency.findUnique({ where: { code: input.currencyCode } });
  if (!currency) {
    throw new NotFoundError(`La devise "${input.currencyCode}" n'est pas prise en charge.`);
  }

  const slug = await findAvailableSlug(tx, input.name);

  const company = await tx.company.create({
    data: {
      name: input.name,
      slug,
      countryCode: input.countryCode,
      currencyCode: input.currencyCode,
      locale: input.locale ?? 'fr',
    },
    select: { id: true },
  });

  // Les roles systeme sont copies dans l'entreprise : elle peut ensuite les
  // ajuster librement sans impacter les autres entreprises de la plateforme.
  await tx.role.createMany({
    data: SYSTEM_ROLES.map((role) => ({
      companyId: company.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
      isSystem: true,
    })),
  });

  const adminRole = await tx.role.findFirstOrThrow({
    where: { companyId: company.id, key: 'ADMIN' },
    select: { id: true },
  });

  const location = await tx.location.create({
    data: {
      companyId: company.id,
      name: 'Etablissement principal',
      code: 'PRINCIPAL',
      kind: 'SHOP',
      isDefault: true,
    },
    select: { id: true },
  });

  // Le catalogue doit etre utilisable des la premiere connexion : sans unites,
  // aucun article ne peut etre saisi correctement.
  await provisionDefaultUnits(tx, company.id);

  // Sans mode de reglement, aucune vente ne peut etre encaissee : les modes
  // courants sont installes d'emblee, l'entreprise ajustera ensuite.
  await provisionPaymentMethods(tx, company.id);
  await provisionExpenseCategories(tx, company.id);

  const membership = await tx.membership.create({
    data: {
      companyId: company.id,
      userId: input.ownerUserId,
      roleId: adminRole.id,
      defaultLocationId: location.id,
      isOwner: true,
    },
    select: { id: true },
  });

  return {
    companyId: company.id,
    membershipId: membership.id,
    locationId: location.id,
    adminRoleId: adminRole.id,
  };
}

export async function getCompanyProfile(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { currency: true },
  });
  if (!company) throw new NotFoundError('Entreprise introuvable.');
  return company;
}

export interface UpdateCompanyInput {
  name?: string;
  legalName?: string | null;
  addressLine?: string | null;
  city?: string | null;
  countryCode?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  taxNumber?: string | null;
  currencyCode?: string;
  primaryColor?: string;
  invoicePrefix?: string;
  quotePrefix?: string;
  salePrefix?: string;
  purchasePrefix?: string;
  documentFooter?: string | null;
  paymentTerms?: string | null;
  defaultDueDays?: number;
}

export async function updateCompany(companyId: string, input: UpdateCompanyInput) {
  if (input.currencyCode) {
    const currency = await prisma.currency.findUnique({ where: { code: input.currencyCode } });
    if (!currency) {
      throw new NotFoundError(`La devise "${input.currencyCode}" n'est pas prise en charge.`);
    }
  }

  return prisma.company.update({
    where: { id: companyId },
    data: input,
    include: { currency: true },
  });
}
