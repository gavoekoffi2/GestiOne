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

export const DOCUMENT_FORMATS = [
  { value: 'A4', label: 'A4 — feuille entiere', hint: 'Facture classique, imprimante bureautique.' },
  { value: 'A5', label: 'A5 — demi-feuille', hint: 'Deux factures par page A4, economise le papier.' },
  { value: 'RECEIPT', label: 'Ticket 80 mm', hint: 'Imprimante thermique de comptoir.' },
] as const;

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]['value'];

/**
 * Logo transmis en `data:` plutot qu'en fichier televerse.
 *
 * Un fichier sur disque suppose un disque : il disparait au premier
 * redeploiement sur un hebergement sans volume persistant, et la facture perd
 * son en-tete sans que personne ne s'en apercoive. L'image voyage donc avec la
 * fiche de l'entreprise, dans la base, et survit a tout.
 *
 * La limite de 300 000 caracteres correspond a environ 220 ko d'image : bien
 * au-dela de ce qu'exige un logo de facture, assez bas pour ne pas alourdir
 * chaque affichage de document.
 */
const logoSchema = z
  .string()
  .trim()
  .max(300_000, "Le logo est trop lourd. Utilisez une image plus petite (moins de 200 ko).")
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .refine(
    (value) => value === undefined || /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value),
    'Format de logo non reconnu. Choisissez une image PNG, JPEG ou WebP.',
  );

const prefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Le prefixe est obligatoire.')
  .max(10, 'Le prefixe ne doit pas depasser 10 caracteres.')
  .regex(/^[A-Z0-9]+$/, 'Le prefixe ne peut contenir que des lettres et des chiffres.');

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
  logoUrl: logoSchema,
  documentFormat: z.enum(['A4', 'A5', 'RECEIPT'], {
    errorMap: () => ({ message: "Choisissez un format d'impression valide." }),
  }),
  invoicePrefix: prefixSchema,
  quotePrefix: prefixSchema,
  salePrefix: prefixSchema,
  purchasePrefix: prefixSchema,
  documentFooter: optionalText(500),
  paymentTerms: optionalText(500),
  defaultDueDays: z.coerce
    .number()
    .int('Le delai doit etre un nombre entier de jours.')
    .min(0, 'Le delai ne peut pas etre negatif.')
    .max(365, 'Le delai ne peut pas depasser 365 jours.'),
});

export const LOCATION_KINDS = [
  { value: 'SHOP', label: 'Boutique' },
  { value: 'WAREHOUSE', label: 'Entrepot / depot' },
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
    .max(20, 'Le code ne doit pas depasser 20 caracteres.')
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
