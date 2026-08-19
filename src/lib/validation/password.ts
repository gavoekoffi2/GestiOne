import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@/server/auth/password';

/**
 * Regles de mot de passe, en un seul endroit.
 *
 * Elles etaient auparavant recopiees dans l'inscription, la creation d'un
 * collaborateur et le changement de mot de passe. Trois copies d'une meme
 * regle finissent toujours par diverger, et la divergence se manifeste au pire
 * moment : un mot de passe accepte a la creation du compte, puis refuse le jour
 * ou l'utilisateur veut le changer.
 */
export const passwordRuleSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caracteres.`,
  )
  .max(200)
  .refine((value) => /[a-zA-Z]/.test(value), 'Le mot de passe doit contenir au moins une lettre.')
  .refine((value) => /\d/.test(value), 'Le mot de passe doit contenir au moins un chiffre.');

export { PASSWORD_MIN_LENGTH };
