import { z } from 'zod';
import { MoneyError, parseAmount } from '@/lib/money';
import { QuantityError, parseQuantity } from '@/lib/quantity';
import { optionalText, requiredText } from './common';

/**
 * Schemas des documents commerciaux.
 *
 * Comme pour le catalogue, les montants dependent de la devise de l'entreprise :
 * les schemas concernes sont des fabriques prenant le nombre de decimales.
 */

/**
 * Champ monetaire obligatoire. Separe de la variante facultative plutot que
 * pilote par un drapeau : ainsi le type rendu est `bigint` et non
 * `bigint | undefined`, et les appelants n'ont pas a re-verifier la presence
 * d'une valeur que le schema garantit deja.
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
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${label} ne peut pas être négatif.`,
          });
          return z.NEVER;
        }
        return parsed;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof MoneyError ? `${label} : montant invalide.` : `${label} invalide.`,
        });
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

/** Pourcentage saisi en clair ("12,5") converti en centiemes de point (1250). */
const percentage = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === '') return 0;
    const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pourcentage invalide.' });
      return z.NEVER;
    }
    if (parsed < 0 || parsed > 100) {
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

export function documentLineSchema(decimals: number) {
  return z.object({
    productId: optionalId,
    description: optionalText(300),
    quantity,
    unitPrice: optionalMoney(decimals, 'Le prix unitaire'),
    discountRate: percentage,
    taxRateId: optionalId,
  });
}

function withDiscount<T extends z.ZodRawShape>(shape: T, decimals: number) {
  return z
    .object({
      ...shape,
      discountAmount: optionalMoney(decimals, 'La remise'),
      discountRate: percentage,
    })
    .superRefine((value, ctx) => {
      // Laisser saisir les deux produirait deux totaux differents selon l'ordre
      // d'application : on impose un choix.
      const hasAmount = value.discountAmount !== undefined && value.discountAmount > 0n;
      const hasRate = (value.discountRate ?? 0) > 0;
      if (hasAmount && hasRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountRate'],
          message: 'Choisissez une remise en montant ou en pourcentage, pas les deux.',
        });
      }
    });
}

export function invoiceSchema(decimals: number) {
  return withDiscount(
    {
      customerId: optionalId,
      locationId: optionalId,
      issueDate: optionalDate,
      dueDate: optionalDate,
      lines: z.array(documentLineSchema(decimals)).min(1, 'Ajoutez au moins une ligne.'),
      notes: optionalText(1000),
      terms: optionalText(1000),
      issue: z.coerce.boolean().default(false),
    },
    decimals,
  );
}

export function quoteSchema(decimals: number) {
  return withDiscount(
    {
      customerId: optionalId,
      locationId: optionalId,
      issueDate: optionalDate,
      validUntil: optionalDate,
      lines: z.array(documentLineSchema(decimals)).min(1, 'Ajoutez au moins une ligne.'),
      notes: optionalText(1000),
      terms: optionalText(1000),
    },
    decimals,
  );
}

export function saleSchema(decimals: number) {
  return withDiscount(
    {
      customerId: optionalId,
      locationId: z.string().trim().min(1, 'Choisissez un point de vente.'),
      lines: z.array(documentLineSchema(decimals)).min(1, 'Ajoutez au moins un article.'),
      notes: optionalText(500),
      payment: z
        .object({
          methodId: z.string().trim().min(1, 'Choisissez un mode de règlement.'),
          amount: optionalMoney(decimals, 'Le montant reçu'),
          reference: optionalText(120),
        })
        .optional(),
    },
    decimals,
  );
}

export function paymentSchema(decimals: number) {
  return z.object({
    direction: z.enum(['IN', 'OUT']).default('IN'),
    amount: requiredMoney(decimals, 'Le montant'),
    invoiceId: optionalId,
    /// Commande fournisseur reglee, pour un decaissement.
    orderId: optionalId,
    partnerId: optionalId,
    methodId: optionalId,
    locationId: optionalId,
    paidAt: optionalDate,
    reference: optionalText(120),
    notes: optionalText(500),
    allowOverpayment: z.coerce.boolean().default(false),
  });
}

export const quoteStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'], {
    errorMap: () => ({ message: 'Statut de devis invalide.' }),
  }),
});

export const convertQuoteSchema = z.object({
  issue: z.coerce.boolean().default(true),
  locationId: optionalId,
  dueDate: optionalDate,
});

export const cancelSchema = z.object({
  reason: requiredText('Le motif', 200),
});

export const paymentMethodSchema = z.object({
  name: requiredText('Le nom du mode de règlement', 60),
  kind: z
    .enum(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'])
    .default('OTHER'),
  affectsCash: z.coerce.boolean().default(false),
  requiresReference: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});

export const taxRateSchema = z.object({
  name: requiredText('Le nom du taux', 60),
  rate: z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Le taux doit être compris entre 0 et 100.',
        });
        return z.NEVER;
      }
      return Math.round(parsed * 100);
    }),
  isDefault: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});
