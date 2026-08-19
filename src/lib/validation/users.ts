import { z } from 'zod';
import { emailSchema, optionalText, phoneSchema, requiredText } from './common';
import { passwordRuleSchema as passwordSchema } from './password';

export const createMemberSchema = z.object({
  fullName: requiredText('Le nom du collaborateur', 120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  roleId: z.string().trim().min(1, 'Choisissez un role.'),
  defaultLocationId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

export const updateMemberSchema = z.object({
  roleId: z.string().trim().min(1, 'Choisissez un role.'),
  defaultLocationId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  isActive: z.coerce.boolean(),
});

export const roleSchema = z.object({
  name: requiredText('Le nom du role', 60),
  description: optionalText(200),
  permissions: z.array(z.string().trim().min(1)).max(200),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
