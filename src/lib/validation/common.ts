import { z } from 'zod';

/** Champ texte obligatoire, espaces superflus retires. */
export const requiredText = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} est obligatoire.` })
    .trim()
    .min(1, `${label} est obligatoire.`)
    .max(max, `${label} ne doit pas depasser ${max} caracteres.`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse email invalide.')
  .max(254);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .refine(
    (value) => value === undefined || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    'Adresse email invalide.',
  );

/**
 * Numeros de telephone : les formats varient fortement d'un pays a l'autre
 * (+225 07 00 00 00 00, 0244 000 000, +234 803 000 0000...). On valide donc la
 * forme generale sans imposer un plan de numerotation national.
 */
export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .refine(
    (value) => value === undefined || /^\+?[\d\s().-]{6,32}$/.test(value),
    'Numero de telephone invalide.',
  );

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Le code pays doit contenir 2 lettres (ex. CI, SN, GH).');

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Le code devise doit contenir 3 lettres (ex. XOF, EUR).');

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (format attendu : #0F766E).');

export const cuidSchema = z.string().trim().min(1, 'Identifiant manquant.').max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Transforme un nom en identifiant d'URL stable et sans accent. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
