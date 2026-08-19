import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/server/db';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';

/**
 * Referentiels commerciaux : modes de reglement et taux de taxe.
 *
 * Les modes de reglement installes par defaut couvrent ce qu'une PME rencontre
 * au quotidien sur la plupart des marches. Aucun operateur n'est code en dur :
 * "Mobile Money" est un mode de reglement generique, et l'integration d'un
 * fournisseur de paiement precis (Wave, Orange Money, M-Pesa, MTN MoMo...)
 * viendra s'y rattacher plus tard sans changer le modele de donnees.
 */
export const DEFAULT_PAYMENT_METHODS = [
  {
    code: 'CASH',
    name: 'Especes',
    kind: 'CASH',
    isCredit: false,
    affectsCash: true,
    requiresReference: false,
    position: 1,
  },
  {
    code: 'MOBILE_MONEY',
    name: 'Mobile Money',
    kind: 'MOBILE_MONEY',
    isCredit: false,
    affectsCash: false,
    requiresReference: true,
    position: 2,
  },
  {
    code: 'BANK_TRANSFER',
    name: 'Virement bancaire',
    kind: 'BANK_TRANSFER',
    isCredit: false,
    affectsCash: false,
    requiresReference: true,
    position: 3,
  },
  {
    code: 'CARD',
    name: 'Carte bancaire',
    kind: 'CARD',
    isCredit: false,
    affectsCash: false,
    requiresReference: false,
    position: 4,
  },
  {
    code: 'CHEQUE',
    name: 'Cheque',
    kind: 'CHEQUE',
    isCredit: false,
    affectsCash: false,
    requiresReference: true,
    position: 5,
  },
  {
    code: 'CREDIT',
    name: 'Credit (a payer plus tard)',
    kind: 'CREDIT',
    isCredit: true,
    affectsCash: false,
    requiresReference: false,
    position: 6,
  },
] as const;

export async function provisionPaymentMethods(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.paymentMethod.createMany({
    data: DEFAULT_PAYMENT_METHODS.map((method) => ({ ...method, companyId, isSystem: true })),
    skipDuplicates: true,
  });
}

export async function listPaymentMethods(companyId: string, includeInactive = false) {
  return prisma.paymentMethod.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });
}

export interface PaymentMethodInput {
  name: string;
  kind: string;
  affectsCash: boolean;
  requiresReference: boolean;
  isActive: boolean;
}

export async function createPaymentMethod(companyId: string, input: PaymentMethodInput) {
  const code = input.name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 30);
  const duplicate = await prisma.paymentMethod.findFirst({
    where: { companyId, code },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Un mode de reglement porte deja ce nom.');

  const last = await prisma.paymentMethod.findFirst({
    where: { companyId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return prisma.paymentMethod.create({
    data: {
      companyId,
      code,
      name: input.name,
      kind: input.kind,
      // Seul le mode systeme CREDIT constate une creance ; un mode ajoute par
      // l'entreprise est toujours un encaissement reel.
      isCredit: false,
      affectsCash: input.affectsCash,
      requiresReference: input.requiresReference,
      isActive: input.isActive,
      isSystem: false,
      position: (last?.position ?? 0) + 1,
    },
  });
}

export async function updatePaymentMethod(
  companyId: string,
  methodId: string,
  input: PaymentMethodInput,
) {
  const method = await prisma.paymentMethod.findFirst({ where: { id: methodId, companyId } });
  if (!method) throw new NotFoundError('Mode de reglement introuvable.');

  return prisma.paymentMethod.update({
    where: { id: methodId },
    data: {
      name: input.name,
      // Le type d'un mode systeme est structurant (CREDIT ne solde pas une
      // facture, CASH alimente la caisse) : il n'est pas modifiable.
      kind: method.isSystem ? method.kind : input.kind,
      affectsCash: method.isSystem ? method.affectsCash : input.affectsCash,
      requiresReference: input.requiresReference,
      isActive: input.isActive,
    },
  });
}

export async function deletePaymentMethod(companyId: string, methodId: string) {
  const method = await prisma.paymentMethod.findFirst({ where: { id: methodId, companyId } });
  if (!method) throw new NotFoundError('Mode de reglement introuvable.');
  if (method.isSystem) {
    throw new ValidationError(
      'Les modes de reglement fournis ne peuvent pas etre supprimes. Vous pouvez les desactiver.',
    );
  }

  const used = await prisma.payment.count({ where: { companyId, methodId } });
  if (used > 0) {
    // Supprimer le mode effacerait l'information de reglement de paiements
    // deja enregistres : on le desactive.
    return prisma.paymentMethod.update({ where: { id: methodId }, data: { isActive: false } });
  }

  await prisma.paymentMethod.delete({ where: { id: methodId } });
  return null;
}

// --------------------------------------------------------------------------
// Taux de taxe
// --------------------------------------------------------------------------

export async function listTaxRates(companyId: string, includeInactive = false) {
  return prisma.taxRate.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isDefault: 'desc' }, { rate: 'asc' }],
  });
}

export interface TaxRateInput {
  name: string;
  /** Taux en centiemes de point : 1800 = 18,00 %. */
  rate: number;
  isDefault: boolean;
  isActive: boolean;
}

export async function createTaxRate(companyId: string, input: TaxRateInput) {
  const duplicate = await prisma.taxRate.findFirst({
    where: { companyId, name: input.name },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Un taux de taxe porte deja ce nom.');

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.taxRate.updateMany({ where: { companyId }, data: { isDefault: false } });
    }
    return tx.taxRate.create({ data: { ...input, companyId } });
  });
}

export async function updateTaxRate(companyId: string, taxRateId: string, input: TaxRateInput) {
  const existing = await prisma.taxRate.findFirst({ where: { id: taxRateId, companyId } });
  if (!existing) throw new NotFoundError('Taux de taxe introuvable.');

  const duplicate = await prisma.taxRate.findFirst({
    where: { companyId, name: input.name, id: { not: taxRateId } },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError('Un taux de taxe porte deja ce nom.');

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.taxRate.updateMany({
        where: { companyId, id: { not: taxRateId } },
        data: { isDefault: false },
      });
    }
    return tx.taxRate.update({ where: { id: taxRateId }, data: input });
  });
}

export async function deleteTaxRate(companyId: string, taxRateId: string) {
  const existing = await prisma.taxRate.findFirst({ where: { id: taxRateId, companyId } });
  if (!existing) throw new NotFoundError('Taux de taxe introuvable.');

  // Les documents conservent le taux applique sous forme de nombre : supprimer
  // le referentiel ne rend donc aucune facture incoherente.
  await prisma.taxRate.delete({ where: { id: taxRateId } });
}
