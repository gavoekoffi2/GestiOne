import { z } from 'zod';
import { MoneyError, parseAmount } from '@/lib/money';
import { QuantityError, parseQuantity } from '@/lib/quantity';
import { optionalEmail, optionalText, phoneSchema, requiredText } from './common';

/**
 * Schemas des referentiels.
 *
 * Les montants dependent de la devise de l'entreprise : les schemas concernes
 * sont donc des **fabriques** prenant le nombre de decimales en parametre.
 * C'est ce qui garantit qu'une saisie "1500" vaut 1 500 F CFA en XOF et
 * 15,00 EUR en euro, sans aucune constante codee en dur.
 */

function moneyField(decimals: number, label: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      try {
        return parseAmount(value, decimals);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof MoneyError ? `${label} : montant invalide.` : `${label} invalide.`,
        });
        return z.NEVER;
      }
    })
    .refine((value) => value >= 0n, `${label} ne peut pas être négatif.`);
}

function optionalMoneyField(decimals: number, label: string) {
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

function quantityField(label: string) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return 0n;
      try {
        const parsed = parseQuantity(value);
        if (parsed < 0n) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ne peut pas être négatif.` });
          return z.NEVER;
        }
        return parsed;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof QuantityError ? `${label} : quantité invalide.` : `${label} invalide.`,
        });
        return z.NEVER;
      }
    });
}

export const PARTNER_KINDS = ['CUSTOMER', 'SUPPLIER'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export function partnerSchema(decimals: number) {
  return z.object({
    name: requiredText('Le nom', 120),
    companyName: optionalText(160),
    phone: phoneSchema,
    secondPhone: phoneSchema,
    email: optionalEmail,
    addressLine: optionalText(200),
    city: optionalText(80),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((value) => (value === '' ? undefined : value))
      .refine((value) => value === undefined || value.length === 2, 'Code pays invalide.'),
    taxNumber: optionalText(60),
    creditLimit: optionalMoneyField(decimals, "Le plafond d'encours"),
    notes: optionalText(1000),
    isActive: z.coerce.boolean().default(true),
  });
}

export const categorySchema = z.object({
  name: requiredText('Le nom de la catégorie', 80),
  parentId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

export const unitSchema = z.object({
  name: requiredText("Le nom de l'unité", 40),
  symbol: z
    .string()
    .trim()
    .min(1, 'Le symbole est obligatoire.')
    .max(12, 'Le symbole ne doit pas dépasser 12 caractères.'),
});

export const PRODUCT_KINDS = [
  { value: 'GOOD', label: 'Produit physique' },
  { value: 'SERVICE', label: 'Service' },
] as const;

export function productSchema(decimals: number) {
  return z
    .object({
      kind: z.enum(['GOOD', 'SERVICE'], {
        errorMap: () => ({ message: 'Choisissez un produit physique ou un service.' }),
      }),
      name: requiredText("Le nom de l'article", 160),
      sku: optionalText(40),
      barcode: optionalText(64),
      description: optionalText(1000),
      categoryId: optionalText(64),
      unitId: optionalText(64),
      supplierId: optionalText(64),
      costPrice: moneyField(decimals, "Le prix d'achat"),
      salePrice: moneyField(decimals, 'Le prix de vente'),
      wholesalePrice: optionalMoneyField(decimals, 'Le prix grossiste'),
      wholesaleFrom: quantityField('La quantité minimale pour le prix grossiste'),
      specialPrice: optionalMoneyField(decimals, 'Le prix spécial'),
      minStock: quantityField('Le stock minimum'),
      isActive: z.coerce.boolean().default(true),
    })
    .superRefine((value, ctx) => {
      // Un prix de gros superieur au prix de detail est presque toujours une
      // erreur de saisie : le signaler evite de vendre a perte sans s'en rendre
      // compte sur des dizaines de cartons.
      if (value.wholesalePrice !== undefined && value.wholesalePrice > value.salePrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['wholesalePrice'],
          message: 'Le prix grossiste est supérieur au prix de vente au détail.',
        });
      }
      if (value.wholesalePrice !== undefined && value.wholesaleFrom <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['wholesaleFrom'],
          message: 'Indiquez à partir de quelle quantité le prix grossiste s applique.',
        });
      }
    });
}

export type CategoryInput = z.infer<typeof categorySchema>;
export type UnitInput = z.infer<typeof unitSchema>;
export type PartnerInput = z.infer<ReturnType<typeof partnerSchema>>;
export type ProductInput = z.infer<ReturnType<typeof productSchema>>;
