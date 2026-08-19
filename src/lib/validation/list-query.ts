import { z } from 'zod';

/** Parametres communs aux listes paginees et filtrees. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  includeInactive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export const productListQuerySchema = listQuerySchema.extend({
  categoryId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  kind: z
    .enum(['GOOD', 'SERVICE'])
    .optional()
    .catch(undefined),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;
