import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@/server/auth/password';
import { emailSchema, optionalText, phoneSchema, requiredText } from './common';

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .max(200)
  .refine((value) => /[a-zA-Z]/.test(value), 'Le mot de passe doit contenir au moins une lettre.')
  .refine((value) => /\d/.test(value), 'Le mot de passe doit contenir au moins un chiffre.');

export const createMemberSchema = z.object({
  fullName: requiredText('Le nom du collaborateur', 120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  roleId: z.string().trim().min(1, 'Choisissez un rôle.'),
  defaultLocationId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

export const updateMemberSchema = z.object({
  roleId: z.string().trim().min(1, 'Choisissez un rôle.'),
  defaultLocationId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  isActive: z.coerce.boolean(),
});

export const roleSchema = z.object({
  name: requiredText('Le nom du rôle', 60),
  description: optionalText(200),
  permissions: z.array(z.string().trim().min(1)).max(200),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
