import { z } from 'zod';
import {
  countryCodeSchema,
  currencyCodeSchema,
  hexColorSchema,
  optionalEmail,
  optionalText,
  phoneSchema,
  requiredText,
} from './common';

const prefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Le préfixe est obligatoire.')
  .max(10, 'Le préfixe ne doit pas dépasser 10 caractères.')
  .regex(/^[A-Z0-9]+$/, 'Le préfixe ne peut contenir que des lettres et des chiffres.');

export const updateCompanySchema = z.object({
  name: requiredText("Le nom de l'entreprise", 120),
  legalName: optionalText(160),
  addressLine: optionalText(200),
  city: optionalText(80),
  countryCode: countryCodeSchema,
  phone: phoneSchema,
  email: optionalEmail,
  website: optionalText(200),
  taxNumber: optionalText(60),
  currencyCode: currencyCodeSchema,
  primaryColor: hexColorSchema,
  invoicePrefix: prefixSchema,
  quotePrefix: prefixSchema,
  salePrefix: prefixSchema,
  purchasePrefix: prefixSchema,
  documentFooter: optionalText(500),
  paymentTerms: optionalText(500),
  defaultDueDays: z.coerce
    .number()
    .int('Le délai doit être un nombre entier de jours.')
    .min(0, 'Le délai ne peut pas être négatif.')
    .max(365, 'Le délai ne peut pas dépasser 365 jours.'),
});

export const LOCATION_KINDS = [
  { value: 'SHOP', label: 'Boutique' },
  { value: 'WAREHOUSE', label: 'Entrepot / dépôt' },
  { value: 'AGENCY', label: 'Agence' },
  { value: 'POS', label: 'Point de vente' },
] as const;

export const locationSchema = z.object({
  name: requiredText('Le nom du point de vente', 120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Le code est obligatoire.')
    .max(20, 'Le code ne doit pas dépasser 20 caractères.')
    .regex(/^[A-Z0-9-]+$/, 'Le code ne peut contenir que des lettres, chiffres et tirets.'),
  kind: z.enum(['SHOP', 'WAREHOUSE', 'AGENCY', 'POS'], {
    errorMap: () => ({ message: 'Choisissez un type de point de vente valide.' }),
  }),
  addressLine: optionalText(200),
  city: optionalText(80),
  phone: phoneSchema,
  isDefault: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type LocationInput = z.infer<typeof locationSchema>;
