import { z } from 'zod';
import { phoneSchema, requiredText } from './common';
import { passwordRuleSchema } from './password';

/**
 * Compte personnel : identite et mot de passe.
 *
 * L'adresse email n'est volontairement pas modifiable ici. Elle sert
 * d'identifiant de connexion et peut etre partagee entre plusieurs
 * entreprises : la changer sans verification de la nouvelle adresse
 * permettrait de detourner un compte, ou de perdre l'acces sur une faute de
 * frappe. Tant qu'aucun envoi de courriel n'est branche, GestiOne ne peut pas
 * verifier une adresse — il ne propose donc pas de la changer.
 */

export const profileSchema = z.object({
  fullName: requiredText('Votre nom', 120),
  phone: phoneSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Indiquez votre mot de passe actuel.').max(200),
  newPassword: passwordRuleSchema,
});

export const resetMemberPasswordSchema = z.object({
  password: passwordRuleSchema,
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetMemberPasswordInput = z.infer<typeof resetMemberPasswordSchema>;
