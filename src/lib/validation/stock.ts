import { z } from 'zod';
import { QuantityError, parseQuantity } from '@/lib/quantity';
import { MoneyError, parseAmount } from '@/lib/money';
import { optionalText } from './common';

/** Quantite strictement positive, exprimee dans l'unite de l'article. */
const positiveQuantity = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    try {
      const parsed = parseQuantity(value);
      if (parsed <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La quantite doit etre superieure a zero.',
        });
        return z.NEVER;
      }
      return parsed;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof QuantityError ? 'Quantite invalide.' : 'Quantite invalide.',
      });
      return z.NEVER;
    }
  });

const countedQuantity = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    const parsed = parseQuantity(value);
    if (parsed < 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La quantite comptee ne peut pas etre negative.',
      });
      return z.NEVER;
    }
    return parsed;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Quantite invalide.' });
    return z.NEVER;
  }
});

function optionalCost(decimals: number) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      try {
        const parsed = parseAmount(value, decimals);
        if (parsed < 0n) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Le cout d'achat ne peut pas etre negatif.",
          });
          return z.NEVER;
        }
        return parsed;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof MoneyError ? 'Montant invalide.' : 'Montant invalide.',
        });
        return z.NEVER;
      }
    });
}

const productId = z.string().trim().min(1, 'Choisissez un article.');
const locationId = z.string().trim().min(1, 'Choisissez un point de vente.');

export function stockEntrySchema(decimals: number) {
  return z.object({
    productId,
    locationId,
    quantity: positiveQuantity,
    unitCost: optionalCost(decimals),
    reason: optionalText(200),
    reference: optionalText(80),
  });
}

export const stockExitSchema = z.object({
  productId,
  locationId,
  quantity: positiveQuantity,
  reason: optionalText(200),
  reference: optionalText(80),
});

export const stockTransferSchema = z
  .object({
    productId,
    fromLocationId: z.string().trim().min(1, 'Choisissez le point de vente de depart.'),
    toLocationId: z.string().trim().min(1, "Choisissez le point de vente d'arrivee."),
    quantity: positiveQuantity,
    reason: optionalText(200),
    reference: optionalText(80),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    path: ['toLocationId'],
    message: 'Le point de vente d arrivee doit differer de celui de depart.',
  });

export const stockInventorySchema = z.object({
  productId,
  locationId,
  countedQuantity,
  reason: z
    .string()
    .trim()
    .min(1, "Indiquez le motif de l'inventaire.")
    .max(200),
});

export const MOVEMENT_KIND_OPTIONS = [
  { value: 'IN', label: 'Entree' },
  { value: 'OUT', label: 'Sortie' },
  { value: 'TRANSFER_IN', label: 'Transfert (reception)' },
  { value: 'TRANSFER_OUT', label: 'Transfert (expedition)' },
  { value: 'INVENTORY', label: 'Inventaire' },
  { value: 'ADJUSTMENT', label: 'Ajustement' },
] as const;
