import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@/server/auth/password';
import { countryCodeSchema, currencyCodeSchema, emailSchema, phoneSchema, requiredText } from './common';

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(200)
  .refine((value) => /[a-zA-Z]/.test(value), 'Le mot de passe doit contenir au moins une lettre.')
  .refine((value) => /\d/.test(value), 'Le mot de passe doit contenir au moins un chiffre.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Le mot de passe est obligatoire.').max(200),
});

export const registerSchema = z.object({
  fullName: requiredText('Votre nom', 120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  companyName: requiredText("Le nom de l'entreprise", 120),
  countryCode: countryCodeSchema.default('CI'),
  currencyCode: currencyCodeSchema.default('XOF'),
});

export const switchCompanySchema = z.object({
  membershipId: z.string().trim().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
