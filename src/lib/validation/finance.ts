import { z } from 'zod';
import { MoneyError, parseAmount } from '@/lib/money';
import { QuantityError, parseQuantity } from '@/lib/quantity';
import { optionalText, requiredText } from './common';

/**
 * Schemas des modules financiers : achats, depenses, caisse.
 * Comme ailleurs, les montants dependent de la devise : fabriques parametrees.
 */

function requiredMoney(decimals: number, label: string) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} est obligatoire.` });
      return z.NEVER;
    }
    try {
      const parsed = parseAmount(value, decimals);
      if (parsed < 0n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ne peut pas être négatif.` });
        return z.NEVER;
      }
      return parsed;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyError ? `${label} : montant invalide.` : `${label} invalide.`,
      });
      return z.NEVER;
    }
  });
}

function optionalMoney(decimals: number, label: string) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return undefined;
      try {
        const parsed = parseAmount(value, decimals);
        if (parsed < 0n) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ne peut pas être négatif.` });
          return z.NEVER;
        }
        return parsed;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} : montant invalide.` });
        return z.NEVER;
      }
    });
}

const quantity = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    const parsed = parseQuantity(value);
    if (parsed <= 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La quantité doit être supérieure à zéro.',
      });
      return z.NEVER;
    }
    return parsed;
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof QuantityError ? 'Quantité invalide.' : 'Quantité invalide.',
    });
    return z.NEVER;
  }
});

const percentage = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === '') return 0;
    const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Le pourcentage doit être compris entre 0 et 100.',
      });
      return z.NEVER;
    }
    return Math.round(parsed * 100);
  });

const optionalId = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date invalide.' });
      return z.NEVER;
    }
    return date;
  });

export function purchaseSchema(decimals: number) {
  return z
    .object({
      supplierId: optionalId,
      locationId: optionalId,
      orderDate: optionalDate,
      expectedAt: optionalDate,
      dueDate: optionalDate,
      lines: z
        .array(
          z.object({
            productId: optionalId,
            description: optionalText(300),
            quantity,
            unitCost: optionalMoney(decimals, 'Le coût unitaire'),
            discountRate: percentage,
            taxRateId: optionalId,
          }),
        )
        .min(1, 'Ajoutez au moins une ligne.'),
      discountAmount: optionalMoney(decimals, 'La remise'),
      discountRate: percentage,
      notes: optionalText(1000),
      reference: optionalText(120),
      order: z.coerce.boolean().default(false),
      receiveNow: z.coerce.boolean().default(false),
    })
    .superRefine((value, ctx) => {
      const hasAmount = value.discountAmount !== undefined && value.discountAmount > 0n;
      if (hasAmount && (value.discountRate ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountRate'],
          message: 'Choisissez une remise en montant ou en pourcentage, pas les deux.',
        });
      }
    });
}

export const receiveSchema = z.object({
  locationId: optionalId,
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        quantity: z.union([z.string(), z.number()]).transform((value, ctx) => {
          try {
            const parsed = parseQuantity(value);
            if (parsed < 0n) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'La quantité reçue ne peut pas être négative.',
              });
              return z.NEVER;
            }
            return parsed;
          } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Quantité invalide.' });
            return z.NEVER;
          }
        }),
      }),
    )
    .min(1, 'Indiquez au moins une quantité réceptionnée.'),
});

export function expenseSchema(decimals: number) {
  return z.object({
    categoryId: optionalId,
    locationId: optionalId,
    supplierId: optionalId,
    methodId: optionalId,
    amount: requiredMoney(decimals, 'Le montant'),
    spentAt: optionalDate,
    description: requiredText('La description', 300),
    reference: optionalText(120),
    notes: optionalText(500),
  });
}

export const expenseCategorySchema = z.object({
  name: requiredText('Le nom de la catégorie', 60),
});

export function openCashSchema(decimals: number) {
  return z.object({
    locationId: z.string().trim().min(1, 'Choisissez un point de vente.'),
    openingAmount: requiredMoney(decimals, 'Le fonds de caisse'),
  });
}

export function closeCashSchema(decimals: number) {
  return z.object({
    countedAmount: requiredMoney(decimals, 'Le montant compte'),
    notes: optionalText(500),
  });
}

export function cashMovementSchema(decimals: number) {
  return z.object({
    locationId: z.string().trim().min(1, 'Choisissez un point de vente.'),
    kind: z.enum(['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'], {
      errorMap: () => ({ message: 'Type de mouvement invalide.' }),
    }),
    amount: requiredMoney(decimals, 'Le montant'),
    reason: requiredText('Le motif', 200),
  });
}
